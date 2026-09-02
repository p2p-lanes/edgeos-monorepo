"""The two reads the portal makes before anyone pays.

What matters here is what an anonymous caller can and cannot see: the step
gate must hold on the read side too (otherwise a checkout with the section
turned off still answers questions about the inventory), the property subset
must be honoured, and nothing internal (units, guest names, the operator's
contact for the building) may leave the building.
"""

import uuid
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.accommodation.availability import create_booking
from app.api.accommodation.constants import (
    ACCOMMODATION_STEP_TEMPLATE,
    HOUSING_STEP_TYPE,
    BookingStatus,
)
from app.api.accommodation.crud import (
    accommodation_price_rules_crud,
    accommodation_properties_crud,
    accommodation_units_crud,
    accommodations_crud,
)
from app.api.accommodation.schemas import (
    AccommodationCreate,
    AccommodationPriceRuleCreate,
    AccommodationPropertyCreate,
    AccommodationUnitBulkCreate,
)
from app.api.application.models import Applications
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps
from app.core.security import create_access_token
from tests._flow_helpers import seed_default_steps

JUN_1 = "2026-06-01"
JUN_8 = "2026-06-08"


@pytest.fixture(autouse=True)
def disable_rate_limit():
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    min_stay: int = 1,
    sale_type: str = SaleType.direct.value,
) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name="Stay Popup",
        slug=f"stay-{uuid.uuid4().hex[:6]}",
        sale_type=sale_type,
        status="active",
        simplefi_api_key="simplefi_test_key",
        currency="USD",
        accommodation_min_stay=min_stay,
    )
    db.add(popup)
    db.flush()
    seed_default_steps(db, popup, sale_type=sale_type)
    return popup


def _default_flow(db: Session, popup: Popups) -> SalesFlows:
    flow = sales_flows_crud.get_default_flow(db, popup.id)
    assert flow is not None
    return flow


def _make_flow(db: Session, popup: Popups, slug: str) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=slug,
        name=slug.title(),
        type=SaleType.direct.value,
    )
    db.add(flow)
    db.flush()
    return flow


def _enable_step(
    db: Session,
    popup: Popups,
    *,
    flow: SalesFlows | None = None,
    enabled: bool = True,
    config: dict | None = None,
) -> TicketingSteps:
    flow = flow or _default_flow(db, popup)
    step = db.exec(
        select(TicketingSteps).where(
            TicketingSteps.sales_flow_id == flow.id,
            TicketingSteps.step_type == HOUSING_STEP_TYPE,
        )
    ).first()
    if step is None:
        step = TicketingSteps(
            id=uuid.uuid4(),
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            step_type=HOUSING_STEP_TYPE,
            title="Accommodation",
            order=1,
            product_category="housing",
        )
    step.is_enabled = enabled
    step.template = ACCOMMODATION_STEP_TEMPLATE
    step.template_config = config
    db.add(step)
    db.flush()
    return step


def _make_inventory(
    db: Session,
    popup: Popups,
    *,
    units: int = 2,
    nightly: str = "120.00",
    tax: str | None = "10.00",
    capacity: int = 2,
    visible: bool = True,
    property_active: bool = True,
    min_stay_override: int | None = None,
):
    property_row = accommodation_properties_crud.create_for_tenant(
        db,
        AccommodationPropertyCreate(
            popup_id=popup.id,
            name=f"Hotel {uuid.uuid4().hex[:6]}",
            contact_email="owner@hotel.test",
            contact_name="The Owner",
            tax_percentage=Decimal(tax) if tax else None,
            is_active=property_active,
        ),
        popup.tenant_id,
    )
    accommodation = accommodations_crud.create_for_tenant(
        db,
        AccommodationCreate(
            popup_id=popup.id,
            property_id=property_row.id,
            name="Double Room",
            guest_capacity=capacity,
            default_nightly_price=Decimal(nightly),
            min_stay_override=min_stay_override,
            visible_in_checkout=visible,
            bookable_from=date(2026, 6, 1),
            bookable_to=date(2026, 7, 31),
        ),
        popup.tenant_id,
    )
    if units:
        accommodation_units_crud.bulk_create(
            db,
            accommodation,
            AccommodationUnitBulkCreate(prefix="Room ", count=units),
        )
        db.refresh(accommodation)
    return property_row, accommodation


def _offer(
    client: TestClient,
    db: Session,
    popup: Popups,
    tenant: Tenants,
    *,
    flow: SalesFlows | None = None,
):
    flow = flow or _default_flow(db, popup)
    return client.get(
        f"/api/v1/checkout/{popup.slug}/{flow.slug}/accommodations",
        headers={"X-Tenant-Id": str(tenant.id)},
    )


def _availability(
    client: TestClient,
    db: Session,
    popup: Popups,
    tenant: Tenants,
    *,
    flow: SalesFlows | None = None,
    check_in: str = JUN_1,
    check_out: str = JUN_8,
    guest_count: int | None = None,
):
    flow = flow or _default_flow(db, popup)
    body: dict = {"check_in": check_in, "check_out": check_out}
    if guest_count is not None:
        body["guest_count"] = guest_count
    return client.post(
        f"/api/v1/checkout/{popup.slug}/{flow.slug}/accommodations/availability",
        json=body,
        headers={"X-Tenant-Id": str(tenant.id)},
    )


# ---------------------------------------------------------------------------
# The step gate, on the read side
# ---------------------------------------------------------------------------


class TestStepGate:
    def test_a_popup_without_the_step_has_no_accommodations_page(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_inventory(db, popup)
        db.commit()

        assert _offer(client, db, popup, tenant_a).status_code == 404
        assert _availability(client, db, popup, tenant_a).status_code == 404

    def test_a_disabled_step_reads_the_same_as_no_step(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        # 404 rather than 403: whether this checkout has the section switched
        # off is not something an anonymous caller gets to learn.
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup, enabled=False)
        _make_inventory(db, popup)
        db.commit()

        assert _offer(client, db, popup, tenant_a).status_code == 404

    def test_only_the_properties_the_step_offers_come_back(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        offered_property, offered_room = _make_inventory(db, popup)
        _, hidden_room = _make_inventory(db, popup)
        _enable_step(db, popup, config={"property_ids": [str(offered_property.id)]})
        db.commit()

        body = _offer(client, db, popup, tenant_a).json()
        ids = {row["id"] for row in body["accommodations"]}
        assert str(offered_room.id) in ids
        assert str(hidden_room.id) not in ids

        # The availability call has to agree, or a room absent from the page
        # could still be priced by a hand-made request.
        quoted = {
            row["accommodation_id"]
            for row in _availability(client, db, popup, tenant_a).json()
        }
        assert str(hidden_room.id) not in quoted

    def test_an_empty_subset_means_every_property(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _, first = _make_inventory(db, popup)
        _, second = _make_inventory(db, popup)
        _enable_step(db, popup, config={"property_ids": []})
        db.commit()

        ids = {
            row["id"]
            for row in _offer(client, db, popup, tenant_a).json()["accommodations"]
        }
        assert {str(first.id), str(second.id)} <= ids

    def test_two_flows_do_not_share_accommodation_inventory(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        first_flow = _default_flow(db, popup)
        second_flow = _make_flow(db, popup, "second-stay")
        first_property, first_room = _make_inventory(db, popup)
        second_property, second_room = _make_inventory(db, popup)
        _enable_step(
            db,
            popup,
            flow=first_flow,
            config={"property_ids": [str(first_property.id)]},
        )
        _enable_step(
            db,
            popup,
            flow=second_flow,
            config={"property_ids": [str(second_property.id)]},
        )
        db.commit()

        first_ids = {
            row["id"]
            for row in _offer(client, db, popup, tenant_a, flow=first_flow).json()[
                "accommodations"
            ]
        }
        second_ids = {
            row["id"]
            for row in _offer(client, db, popup, tenant_a, flow=second_flow).json()[
                "accommodations"
            ]
        }

        assert first_ids == {str(first_room.id)}
        assert second_ids == {str(second_room.id)}


# ---------------------------------------------------------------------------
# What the buyer is allowed to see
# ---------------------------------------------------------------------------


class TestOfferShape:
    def test_units_and_the_owners_contact_never_leave_the_building(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _make_inventory(db, popup)
        db.commit()

        body = _offer(client, db, popup, tenant_a).json()
        room = body["accommodations"][0]
        property_row = body["properties"][0]

        assert "units" not in room
        assert "contact_email" not in property_row
        assert "contact_name" not in property_row
        # The tax percentage does go out: it is a line in the quote and the
        # buyer is entitled to know what it is.
        assert property_row["tax_percentage"] is not None

    def test_the_effective_minimum_stay_is_resolved_server_side(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        # Popup says 2, this room overrides to 4. The portal must not have to
        # re-implement that precedence to grey out the wrong dates.
        popup = _make_popup(db, tenant_a, min_stay=2)
        _enable_step(db, popup)
        _make_inventory(db, popup, min_stay_override=4)
        _make_inventory(db, popup)
        db.commit()

        rooms = _offer(client, db, popup, tenant_a).json()["accommodations"]
        assert sorted(room["min_stay"] for room in rooms) == [2, 4]

    def test_hidden_rooms_and_inactive_properties_are_not_sold(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, hidden = _make_inventory(db, popup, visible=False)
        _, in_closed_building = _make_inventory(db, popup, property_active=False)
        _, sellable = _make_inventory(db, popup)
        db.commit()

        ids = {
            row["id"]
            for row in _offer(client, db, popup, tenant_a).json()["accommodations"]
        }
        assert ids == {str(sellable.id)}
        assert str(hidden.id) not in ids
        assert str(in_closed_building.id) not in ids

    def test_the_shadow_product_id_travels_so_the_purchase_can_name_it(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        # The line the portal submits must point at this product; without it
        # in the offer the client would have no way to build the line.
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup)
        db.commit()

        room = _offer(client, db, popup, tenant_a).json()["accommodations"][0]
        assert room["product_id"] == str(accommodation.product_id)


# ---------------------------------------------------------------------------
# Availability + quote
# ---------------------------------------------------------------------------


class TestAvailability:
    def test_the_quote_comes_back_with_the_count(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _make_inventory(db, popup, units=2, nightly="120.00", tax="10.00")
        db.commit()

        row = _availability(client, db, popup, tenant_a).json()[0]
        assert row["available"] == 2
        assert row["unavailable_reason"] is None
        assert row["quote"]["night_count"] == 7
        assert Decimal(row["quote"]["subtotal"]) == Decimal("840.00")
        assert Decimal(row["quote"]["tax"]) == Decimal("84.00")
        assert Decimal(row["quote"]["total"]) == Decimal("924.00")
        assert row["quote"]["currency"] == "USD"

    def test_a_date_range_rule_overrides_the_nightly_price(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        # This is why the client is not allowed to multiply: the price for
        # these seven nights is not seven times the base rate.
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, nightly="100.00", tax=None)
        accommodation_price_rules_crud.create_for_accommodation(
            db,
            accommodation,
            AccommodationPriceRuleCreate(
                accommodation_id=accommodation.id,
                label="High season",
                nightly_price=Decimal("200.00"),
                start_date=date(2026, 6, 1),
                end_date=date(2026, 6, 4),
                priority=10,
            ),
        )
        db.commit()

        quote = _availability(client, db, popup, tenant_a).json()[0]["quote"]
        # Jun 1-3 at 200, Jun 4-7 at 100; the rule's end date is inclusive.
        assert Decimal(quote["total"]) != Decimal("700.00")
        assert quote["night_count"] == 7

    def test_a_taken_room_reports_sold_out_but_still_shows_its_price(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, units=1)
        create_booking(
            db,
            accommodation=accommodation,
            check_in=date(2026, 6, 1),
            check_out=date(2026, 6, 8),
            status=BookingStatus.CONFIRMED,
        )
        db.commit()

        row = _availability(client, db, popup, tenant_a).json()[0]
        assert row["available"] == 0
        assert row["unavailable_reason"] == "sold_out"
        # A sold-out card with no price reads as broken rather than as taken.
        assert row["quote"] is not None

    def test_a_stay_under_the_minimum_is_refused_with_a_reason(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, min_stay=3)
        _enable_step(db, popup)
        _make_inventory(db, popup)
        db.commit()

        row = _availability(
            client, db, popup, tenant_a, check_in=JUN_1, check_out="2026-06-02"
        ).json()[0]
        assert row["available"] == 0
        assert row["unavailable_reason"] == "min_stay_not_met"

    def test_a_party_too_large_for_the_room_is_told_so_here(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        # Better here than as a rejected purchase three screens later.
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _make_inventory(db, popup, capacity=2)
        db.commit()

        row = _availability(client, db, popup, tenant_a, guest_count=4).json()[0]
        assert row["available"] == 0
        assert row["unavailable_reason"] == "over_capacity"

    def test_dates_outside_the_bookable_window_are_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _make_inventory(db, popup)
        db.commit()

        row = _availability(
            client,
            db,
            popup,
            tenant_a,
            check_in="2026-05-01",
            check_out="2026-05-08",
        ).json()[0]
        assert row["unavailable_reason"] == "outside_bookable_window"

    def test_a_backwards_range_is_rejected_before_it_reaches_the_database(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _make_inventory(db, popup)
        db.commit()

        response = _availability(
            client, db, popup, tenant_a, check_in=JUN_8, check_out=JUN_1
        )
        assert response.status_code == 422

    def test_an_absurdly_long_stay_is_refused_rather_than_quoted(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        # The quote materialises one row per night; an anonymous caller must
        # not be able to ask for a decade of them.
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _make_inventory(db, popup)
        db.commit()

        response = _availability(
            client,
            db,
            popup,
            tenant_a,
            check_in="2026-01-01",
            check_out="2030-01-01",
        )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# The logged-in portal reads the same inventory
# ---------------------------------------------------------------------------

PORTAL_URL = "/api/v1/portal/accommodations"


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"stay-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Ada",
        last_name="Lovelace",
    )
    db.add(human)
    db.flush()
    return human


def _human_auth(human: Humans) -> dict[str, str]:
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def _accept_application(
    db: Session, popup: Popups, flow: SalesFlows, human: Humans
) -> Applications:
    application = Applications(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        human_id=human.id,
        status="accepted",
    )
    db.add(application)
    db.flush()
    return application


class TestPortalReads:
    def test_an_application_popup_serves_its_rooms_to_a_logged_in_buyer(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        # The anonymous endpoint refuses application popups by design; without
        # this pair the step renders an empty state on every popup that is not
        # direct-sale, which is most of them.
        popup = _make_popup(db, tenant_a, sale_type=SaleType.application.value)
        flow = _default_flow(db, popup)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup)
        human = _make_human(db, tenant_a)
        _accept_application(db, popup, flow, human)
        db.commit()

        response = client.get(
            PORTAL_URL,
            params={"popup_id": str(popup.id), "sales_flow_id": str(flow.id)},
            headers=_human_auth(human),
        )
        assert response.status_code == 200, response.text
        ids = {row["id"] for row in response.json()["accommodations"]}
        assert str(accommodation.id) in ids

    def test_the_same_popup_is_refused_anonymously(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, sale_type=SaleType.application.value)
        _enable_step(db, popup)
        _make_inventory(db, popup)
        db.commit()

        # An application popup's inventory stays behind the account, exactly
        # as its products do.
        assert _offer(client, db, popup, tenant_a).status_code == 403

    def test_signing_in_does_not_open_a_step_that_is_off(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, sale_type=SaleType.application.value)
        flow = _default_flow(db, popup)
        _enable_step(db, popup, enabled=False)
        _make_inventory(db, popup)
        human = _make_human(db, tenant_a)
        _accept_application(db, popup, flow, human)
        db.commit()

        response = client.get(
            PORTAL_URL,
            params={"popup_id": str(popup.id), "sales_flow_id": str(flow.id)},
            headers=_human_auth(human),
        )
        assert response.status_code == 404

    def test_it_refuses_an_anonymous_caller(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _default_flow(db, popup)
        _enable_step(db, popup)
        _make_inventory(db, popup)
        db.commit()

        response = client.get(
            PORTAL_URL,
            params={"popup_id": str(popup.id), "sales_flow_id": str(flow.id)},
        )
        assert response.status_code in {401, 403}

    def test_the_quote_matches_the_one_the_anonymous_endpoint_gives(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        # Two doors, one room: a stay must not cost different amounts
        # depending on which flow the buyer came through.
        popup = _make_popup(db, tenant_a)
        flow = _default_flow(db, popup)
        _enable_step(db, popup)
        _make_inventory(db, popup, nightly="120.00", tax="10.00")
        human = _make_human(db, tenant_a)
        db.commit()

        anonymous = _availability(client, db, popup, tenant_a).json()[0]
        logged_in = client.post(
            f"{PORTAL_URL}/availability",
            params={"popup_id": str(popup.id), "sales_flow_id": str(flow.id)},
            json={"check_in": JUN_1, "check_out": JUN_8},
            headers=_human_auth(human),
        ).json()[0]

        assert logged_in["quote"]["total"] == anonymous["quote"]["total"]
        assert logged_in["available"] == anonymous["available"]

    def test_a_popup_from_another_tenant_is_not_found(
        self, client: TestClient, db: Session, tenant_a: Tenants, tenant_b: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _default_flow(db, popup)
        _enable_step(db, popup)
        _make_inventory(db, popup)
        outsider = _make_human(db, tenant_b)
        db.commit()

        response = client.get(
            PORTAL_URL,
            params={"popup_id": str(popup.id), "sales_flow_id": str(flow.id)},
            headers=_human_auth(outsider),
        )
        assert response.status_code == 404
