"""A room bought through the ordinary checkout.

The gateway is not what is under test here: SimpleFI is mocked, exactly as
in the other checkout tests. What is under test is the four things a stay
needs that a normal product does not: a price derived from its dates, a hold
instead of a stock counter, a booking row, and a release when the payment
never completes.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

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
from app.api.accommodation.models import AccommodationBookings
from app.api.accommodation.schemas import (
    AccommodationCreate,
    AccommodationPriceRuleCreate,
    AccommodationPropertyCreate,
    AccommodationUnitBulkCreate,
)
from app.api.attendee.models import AttendeeProducts
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps
from tests._flow_helpers import seed_default_steps

JUN_1 = "2026-06-01"
JUN_8 = "2026-06-08"


@pytest.fixture(autouse=True)
def disable_purchase_rate_limit():
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants, *, min_stay: int = 1) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name="Stay Popup",
        slug=f"stay-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.direct.value,
        status="active",
        simplefi_api_key="simplefi_test_key",
        currency="USD",
        allows_coupons=True,
        accommodation_min_stay=min_stay,
    )
    db.add(popup)
    db.flush()
    seed_default_steps(db, popup, sale_type=popup.sale_type)
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
    """The accommodation step reuses the default flow's seeded housing slot."""
    flow = flow or _default_flow(db, popup)
    step = db.exec(
        select(TicketingSteps).where(
            TicketingSteps.popup_id == popup.id,
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
    tax: str | None = "12.00",
    capacity: int = 2,
):
    property_row = accommodation_properties_crud.create_for_tenant(
        db,
        AccommodationPropertyCreate(
            popup_id=popup.id,
            name=f"Hotel {uuid.uuid4().hex[:6]}",
            tax_percentage=Decimal(tax) if tax else None,
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
            bookable_from=datetime(2026, 6, 1).date(),
            bookable_to=datetime(2026, 7, 31).date(),
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


def _booking_line(accommodation, **overrides) -> dict:
    metadata = {
        "kind": "accommodation_booking",
        "accommodation_id": str(accommodation.id),
        "check_in": JUN_1,
        "check_out": JUN_8,
        "guest_count": 2,
        "guests": [{"name": "Ada"}, {"name": "Grace"}],
    }
    metadata.update(overrides)
    return {
        "product_id": str(accommodation.product_id),
        "quantity": 1,
        "purchase_metadata": metadata,
    }


def _purchase(
    client: TestClient,
    popup: Popups,
    tenant: Tenants,
    lines: list[dict],
    *,
    flow: SalesFlows | None = None,
):
    flow_slug = flow.slug if flow is not None else "checkout"
    request_lines: list[dict] = []
    recipients: list[dict] = []
    for index, original in enumerate(lines):
        line = dict(original)
        if not line.get("attendee_id") and not line.get("recipient_key"):
            recipient_key = f"stay-{index}"
            line["recipient_key"] = recipient_key
            recipients.append(
                {
                    "recipient_key": recipient_key,
                    "name": f"Guest {index + 1}",
                    "email": f"guest-{index + 1}@test.com",
                    "profile_snapshot": {},
                }
            )
        request_lines.append(line)
    with patch("app.services.simplefi.get_simplefi_client") as mock_client:
        mock_client.return_value.create_payment.return_value = SimpleNamespace(
            id=f"sf_{uuid.uuid4().hex[:8]}",
            status="pending",
            checkout_url="https://simplefi.test/checkout/stay",
            is_installment_plan=False,
        )
        return client.post(
            f"/api/v1/checkout/{popup.slug}/{flow_slug}/purchase",
            json={
                "products": request_lines,
                "recipients": recipients,
                "buyer": {
                    "email": f"buyer-{uuid.uuid4().hex[:6]}@test.com",
                    "first_name": "Ada",
                    "last_name": "Lovelace",
                    "form_data": {},
                },
            },
            headers={"X-Tenant-Id": str(tenant.id)},
        )


# ---------------------------------------------------------------------------
# Pricing: the line is charged the quote, never the product's price
# ---------------------------------------------------------------------------


class TestPricing:
    def test_the_charge_comes_from_the_dates_not_the_product_price(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, nightly="120.00", tax="12.00")
        db.commit()

        response = _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        assert response.status_code == 200, response.text

        # 7 nights x 120 = 840, +12% tax = 940.80. The product's own price
        # (120, one night) must never be what is charged.
        assert response.json()["amount"] == "940.80"

        payment = db.exec(select(Payments).where(Payments.popup_id == popup.id)).first()
        line = db.exec(
            select(PaymentProducts).where(PaymentProducts.payment_id == payment.id)
        ).first()
        assert line.effective_unit_price == Decimal("940.80")
        assert line.product_price == Decimal("120.00")

    def test_price_rules_reach_the_charge(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, nightly="100.00", tax=None)
        accommodation_price_rules_crud.create_for_accommodation(
            db,
            accommodation,
            AccommodationPriceRuleCreate(
                start_date=datetime(2026, 6, 5).date(),
                end_date=datetime(2026, 6, 7).date(),
                nightly_price=Decimal("200.00"),
                label="High season",
            ),
        )
        db.commit()

        response = _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        assert response.status_code == 200, response.text
        # Jun 1-4 at 100 (4 nights) + Jun 5-7 at 200 (3 nights) = 1000.
        assert response.json()["amount"] == "1000.00"

    def test_the_client_cannot_send_a_price(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A quote injected into the metadata is overwritten, not trusted."""
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, nightly="120.00", tax=None)
        db.commit()

        line = _booking_line(accommodation)
        line["purchase_metadata"]["quote"] = {"total": "1.00", "subtotal": "1.00"}

        response = _purchase(client, popup, tenant_a, [line])
        assert response.status_code == 200, response.text
        assert response.json()["amount"] == "840.00"

    def test_the_preview_matches_what_is_charged(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, nightly="120.00", tax="12.00")
        db.commit()

        preview = client.post(
            f"/api/v1/checkout/{popup.slug}/checkout/preview",
            json={"products": [_booking_line(accommodation)]},
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert preview.status_code == 200, preview.text
        body = preview.json()
        assert body["total"] == "940.80"

        # The night-by-night breakdown travels with the line so the checkout
        # can show it without re-deriving prices client-side.
        quote = body["lines"][0]["accommodation_quote"]
        assert quote["night_count"] == 7
        assert quote["subtotal"] == "840.00"
        assert quote["tax"] == "100.80"
        assert len(quote["nights"]) == 7

        charged = _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        assert charged.json()["amount"] == body["total"]

    def test_quote_token_detects_a_changed_accommodation_price(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _default_flow(db, popup)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, nightly="100.00", tax=None)
        db.commit()

        line = _booking_line(accommodation)
        line["recipient_key"] = "stay-0"
        buyer = {
            "email": "quoted@test.com",
            "first_name": "Ada",
            "last_name": "Lovelace",
            "form_data": {},
        }
        recipients = [
            {
                "recipient_key": "stay-0",
                "name": "Ada Lovelace",
                "email": "quoted@test.com",
                "profile_snapshot": {},
            }
        ]
        preview = client.post(
            f"/api/v1/checkout/{popup.slug}/{flow.slug}/preview",
            json={"products": [line], "buyer": buyer, "recipients": recipients},
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["quote_token"] is not None

        accommodation.default_nightly_price = Decimal("180.00")
        db.add(accommodation)
        db.commit()

        response = client.post(
            f"/api/v1/checkout/{popup.slug}/{flow.slug}/purchase",
            json={
                "products": [line],
                "buyer": buyer,
                "recipients": recipients,
                "quote_token": preview.json()["quote_token"],
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "requote_required"
        assert response.json()["detail"]["fresh_quote"]["total"] == "1260.00"

    def test_a_coupon_applies_to_the_stay(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        from app.api.coupon.models import Coupons

        popup = _make_popup(db, tenant_a)
        flow = _default_flow(db, popup)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, nightly="100.00", tax=None)
        db.add(
            Coupons(
                id=uuid.uuid4(),
                tenant_id=popup.tenant_id,
                popup_id=popup.id,
                sales_flow_id=flow.id,
                code="HALF",
                discount_value=50,
                is_active=True,
            )
        )
        db.commit()

        with patch("app.services.simplefi.get_simplefi_client") as mock_client:
            mock_client.return_value.create_payment.return_value = SimpleNamespace(
                id="sf_coupon",
                status="pending",
                checkout_url="https://simplefi.test/c",
                is_installment_plan=False,
            )
            line = _booking_line(accommodation)
            line["recipient_key"] = "stay-0"
            response = client.post(
                f"/api/v1/checkout/{popup.slug}/{flow.slug}/purchase",
                json={
                    "products": [line],
                    "recipients": [
                        {
                            "recipient_key": "stay-0",
                            "name": "Ada L",
                            "email": "coupon@test.com",
                            "profile_snapshot": {},
                        }
                    ],
                    "coupon_code": "HALF",
                    "buyer": {
                        "email": "coupon@test.com",
                        "first_name": "Ada",
                        "last_name": "L",
                        "form_data": {},
                    },
                },
                headers={"X-Tenant-Id": str(tenant_a.id)},
            )

        assert response.status_code == 200, response.text
        assert response.json()["amount"] == "350.00"


# ---------------------------------------------------------------------------
# The hold
# ---------------------------------------------------------------------------


class TestHolds:
    def test_a_purchase_holds_a_unit(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, units=2)
        db.commit()

        response = _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        assert response.status_code == 200, response.text

        booking = db.exec(
            select(AccommodationBookings).where(
                AccommodationBookings.accommodation_id == accommodation.id
            )
        ).first()
        assert booking is not None
        assert booking.status == BookingStatus.HOLD
        assert booking.hold_expires_at is not None
        assert booking.payment_id is not None
        assert booking.payment_product_id is not None
        assert booking.guest_count == 2
        assert [g["name"] for g in booking.guests] == ["Ada", "Grace"]
        # The quote is snapshotted so the booking can be explained later even
        # if the rules change.
        assert booking.price_snapshot["total"] == "940.80"

    def test_the_last_unit_cannot_be_sold_twice(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, units=1)
        db.commit()

        first = _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        assert first.status_code == 200, first.text

        second = _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        assert second.status_code == 409
        assert second.json()["detail"]["code"] == "accommodation_unavailable"

    def test_two_rooms_in_one_purchase(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """C7: a cart can hold more than one stay."""
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(
            db, popup, units=2, nightly="100.00", tax=None
        )
        db.commit()

        response = _purchase(
            client,
            popup,
            tenant_a,
            [_booking_line(accommodation), _booking_line(accommodation)],
        )
        assert response.status_code == 200, response.text
        assert response.json()["amount"] == "1400.00"

        payment = db.exec(select(Payments).where(Payments.popup_id == popup.id)).one()
        from app.api.payment.crud import payments_crud

        payments_crud.approve_payment(db, payment.id)
        db.commit()
        db.expire_all()

        bookings = db.exec(
            select(AccommodationBookings).where(
                AccommodationBookings.accommodation_id == accommodation.id
            )
        ).all()
        payment_lines = {
            line.id: line
            for line in db.exec(
                select(PaymentProducts).where(PaymentProducts.payment_id == payment.id)
            ).all()
        }
        product_units = db.exec(
            select(AttendeeProducts).where(AttendeeProducts.payment_id == payment.id)
        ).all()
        assert len(bookings) == 2
        assert len({b.unit_id for b in bookings}) == 2
        assert len({b.attendee_id for b in bookings}) == 2
        assert all(
            booking.attendee_id == payment_lines[booking.payment_product_id].attendee_id
            for booking in bookings
        )
        assert {
            (unit.payment_product_id, unit.attendee_id) for unit in product_units
        } == {(booking.payment_product_id, booking.attendee_id) for booking in bookings}

    def test_different_dates_for_the_same_room_type_price_independently(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Two lines, same product, different totals, which is why prices are
        resolved per line position rather than per product."""
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(
            db, popup, units=2, nightly="100.00", tax=None
        )
        db.commit()

        response = _purchase(
            client,
            popup,
            tenant_a,
            [
                _booking_line(accommodation),  # 7 nights = 700
                _booking_line(
                    accommodation, check_in="2026-06-10", check_out="2026-06-12"
                ),  # 2 nights = 200
            ],
        )
        assert response.status_code == 200, response.text
        assert response.json()["amount"] == "900.00"


# ---------------------------------------------------------------------------
# Approval and release
# ---------------------------------------------------------------------------


class TestLifecycle:
    def test_approval_confirms_the_booking_and_links_the_attendee(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup)
        db.commit()

        assert (
            _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        ).status_code == 200

        payment = db.exec(select(Payments).where(Payments.popup_id == popup.id)).first()

        from app.api.payment.crud import payments_crud

        payments_crud.approve_payment(db, payment.id)
        db.commit()
        db.expire_all()

        booking = db.exec(
            select(AccommodationBookings).where(
                AccommodationBookings.payment_id == payment.id
            )
        ).first()
        assert booking.status == BookingStatus.CONFIRMED
        assert booking.hold_expires_at is None
        assert booking.attendee_id is not None

        # The pass carries the booking metadata, which is what "my stays"
        # renders from.
        ticket = db.exec(
            select(AttendeeProducts).where(AttendeeProducts.payment_id == payment.id)
        ).first()
        assert ticket.purchase_metadata["kind"] == "accommodation_booking"
        assert ticket.purchase_metadata["booking_id"] == str(booking.id)

    def test_releasing_a_pending_payment_frees_the_room(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, units=1)
        db.commit()

        assert (
            _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        ).status_code == 200

        payment = db.exec(select(Payments).where(Payments.popup_id == popup.id)).first()

        from app.api.payment.crud import payments_crud

        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)
        db.expire_all()

        booking = db.exec(
            select(AccommodationBookings).where(
                AccommodationBookings.payment_id == payment.id
            )
        ).first()
        assert booking.status == BookingStatus.EXPIRED

        # And the room is sellable again.
        again = _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        assert again.status_code == 200, again.text

    def test_cancellation_revokes_fulfillment_but_keeps_a_confirmed_stay(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A refund is a separate decision; freeing a paid room would resell
        it under the guest."""
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, units=1)
        db.commit()

        _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        payment = db.exec(select(Payments).where(Payments.popup_id == popup.id)).first()

        from app.api.payment.crud import payments_crud

        payments_crud.approve_payment(db, payment.id)
        product_unit = db.exec(
            select(AttendeeProducts).where(AttendeeProducts.payment_id == payment.id)
        ).one()
        assert product_unit.payment_product_id is not None

        payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)
        db.refresh(product_unit)
        first_revoked_at = product_unit.revoked_at
        payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)
        db.expire_all()

        booking = db.exec(
            select(AccommodationBookings).where(
                AccommodationBookings.payment_id == payment.id
            )
        ).first()
        assert booking.status == BookingStatus.CONFIRMED
        product_unit = db.get(AttendeeProducts, product_unit.id)
        assert product_unit.revoked_at == first_revoked_at
        assert product_unit.revoked_at is not None

    def test_a_failed_purchase_leaves_no_booking_behind(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The hold lives in the payment's transaction: if SimpleFI blows up
        after it, the room must not stay locked."""
        popup = _make_popup(db, tenant_a)
        flow = _default_flow(db, popup)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, units=1)
        db.commit()

        with patch("app.services.simplefi.get_simplefi_client") as mock_client:
            mock_client.return_value.create_payment.side_effect = RuntimeError(
                "gateway down"
            )
            line = _booking_line(accommodation)
            line["recipient_key"] = "stay-0"
            response = client.post(
                f"/api/v1/checkout/{popup.slug}/{flow.slug}/purchase",
                json={
                    "products": [line],
                    "recipients": [
                        {
                            "recipient_key": "stay-0",
                            "name": "Ada L",
                            "email": "boom@test.com",
                            "profile_snapshot": {},
                        }
                    ],
                    "buyer": {
                        "email": "boom@test.com",
                        "first_name": "Ada",
                        "last_name": "L",
                        "form_data": {},
                    },
                },
                headers={"X-Tenant-Id": str(tenant_a.id)},
            )
        assert response.status_code >= 400

        db.rollback()
        db.expire_all()
        remaining = db.exec(
            select(AccommodationBookings).where(
                AccommodationBookings.accommodation_id == accommodation.id
            )
        ).all()
        assert remaining == []

        # And the room is still on sale.
        ok = _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        assert ok.status_code == 200, ok.text


# ---------------------------------------------------------------------------
# The step gate: a disabled step must block the sale, not just hide the UI
# ---------------------------------------------------------------------------


class TestStepGate:
    def test_without_an_enabled_step_the_purchase_is_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup, enabled=False)
        _, accommodation = _make_inventory(db, popup)
        db.commit()

        response = _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "product_not_in_flow"

    def test_a_property_outside_the_step_subset_is_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        offered, _ = _make_inventory(db, popup)
        hidden_property, hidden_room = _make_inventory(db, popup)
        _enable_step(db, popup, config={"property_ids": [str(offered.id)]})
        db.commit()

        response = _purchase(client, popup, tenant_a, [_booking_line(hidden_room)])
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "accommodation_not_offered"
        assert hidden_property.id != offered.id

    def test_an_empty_subset_offers_everything(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup, config={"property_ids": []})
        _, accommodation = _make_inventory(db, popup)
        db.commit()

        response = _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
        assert response.status_code == 200, response.text

    def test_preview_and_purchase_refuse_a_room_from_another_flow(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        first_flow = _default_flow(db, popup)
        second_flow = _make_flow(db, popup, "second-stay")
        first_property, _ = _make_inventory(db, popup)
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

        preview = client.post(
            f"/api/v1/checkout/{popup.slug}/{first_flow.slug}/preview",
            json={"products": [_booking_line(second_room)]},
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        purchase = _purchase(
            client,
            popup,
            tenant_a,
            [_booking_line(second_room)],
            flow=first_flow,
        )

        assert preview.status_code == 422
        assert preview.json()["detail"]["code"] == "accommodation_not_offered"
        assert purchase.status_code == 422
        assert purchase.json()["detail"]["code"] == "accommodation_not_offered"


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class TestValidation:
    def test_a_line_pointing_at_someone_elses_product_is_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Otherwise booking metadata could be attached to a cheap ticket and
        the room paid for at the ticket's price."""
        from app.api.product.models import Products

        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup)
        cheap = Products(
            id=uuid.uuid4(),
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            name="Cheap ticket",
            slug=f"cheap-{uuid.uuid4().hex[:6]}",
            price=Decimal("1.00"),
            category="ticket",
            is_active=True,
        )
        db.add(cheap)
        db.commit()

        line = _booking_line(accommodation)
        line["product_id"] = str(cheap.id)

        response = _purchase(client, popup, tenant_a, [line])
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "accommodation_invalid_booking_data"

    def test_a_booking_line_cannot_multiply_one_stay_with_quantity(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, units=2)
        db.commit()

        line = _booking_line(accommodation)
        line["quantity"] = 2
        response = _purchase(client, popup, tenant_a, [line])

        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "accommodation_invalid_booking_data"

    def test_dates_outside_the_bookable_window_are_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup)
        db.commit()

        response = _purchase(
            client,
            popup,
            tenant_a,
            [
                _booking_line(
                    accommodation, check_in="2026-05-20", check_out="2026-05-25"
                )
            ],
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "outside_bookable_window"

    def test_a_stay_shorter_than_the_popup_minimum_is_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, min_stay=5)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup)
        db.commit()

        response = _purchase(
            client,
            popup,
            tenant_a,
            [_booking_line(accommodation, check_in=JUN_1, check_out="2026-06-03")],
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "min_stay_not_met"

    def test_more_guests_than_the_room_holds_is_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup, capacity=2)
        db.commit()

        response = _purchase(
            client,
            popup,
            tenant_a,
            [
                _booking_line(
                    accommodation,
                    guest_count=4,
                    guests=[{"name": n} for n in "ABCD"],
                )
            ],
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "over_capacity"

    def test_missing_guest_names_are_refused_when_the_step_asks_for_them(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup, config={"require_guest_names": True})
        _, accommodation = _make_inventory(db, popup)
        db.commit()

        response = _purchase(
            client,
            popup,
            tenant_a,
            [_booking_line(accommodation, guest_count=2, guests=[])],
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "accommodation_invalid_booking_data"

    def test_names_are_optional_when_the_step_says_so(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup, config={"require_guest_names": False})
        _, accommodation = _make_inventory(db, popup)
        db.commit()

        response = _purchase(
            client,
            popup,
            tenant_a,
            [_booking_line(accommodation, guest_count=2, guests=[])],
        )
        assert response.status_code == 200, response.text

    def test_a_malformed_date_is_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, accommodation = _make_inventory(db, popup)
        db.commit()

        response = _purchase(
            client,
            popup,
            tenant_a,
            [_booking_line(accommodation, check_in="not-a-date")],
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "accommodation_invalid_booking_data"

    def test_a_room_from_another_popup_is_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        other_popup = _make_popup(db, tenant_a)
        _enable_step(db, popup)
        _, foreign_room = _make_inventory(db, other_popup)
        db.commit()

        response = _purchase(client, popup, tenant_a, [_booking_line(foreign_room)])
        # The product does not belong to this popup either, so the engine's own
        # membership check fires first; both answers are a refusal.
        assert response.status_code == 403


# ---------------------------------------------------------------------------
# Ordinary products keep working
# ---------------------------------------------------------------------------


def test_a_cart_without_a_room_is_untouched(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """The whole point of the shadow product: nothing changes for tickets."""
    from app.api.product.models import Products

    popup = _make_popup(db, tenant_a)
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="GA",
        slug=f"ga-{uuid.uuid4().hex[:6]}",
        price=Decimal("150.00"),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.commit()

    response = _purchase(
        client, popup, tenant_a, [{"product_id": str(product.id), "quantity": 2}]
    )
    assert response.status_code == 200, response.text
    assert response.json()["amount"] == "300.00"

    payment = db.exec(select(Payments).where(Payments.popup_id == popup.id)).first()
    line = db.exec(
        select(PaymentProducts).where(PaymentProducts.payment_id == payment.id)
    ).first()
    assert line.effective_unit_price is None
    assert line.purchase_metadata is None


def test_hold_expiry_is_the_pending_payment_window(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """C12: a room is held for exactly as long as the payment stays pending."""
    from app.core.config import settings

    popup = _make_popup(db, tenant_a)
    _enable_step(db, popup)
    _, accommodation = _make_inventory(db, popup)
    db.commit()

    before = datetime.now(UTC)
    _purchase(client, popup, tenant_a, [_booking_line(accommodation)])

    booking = db.exec(
        select(AccommodationBookings).where(
            AccommodationBookings.accommodation_id == accommodation.id
        )
    ).first()
    expected = before + timedelta(minutes=settings.PENDING_SWEEP_STALE_MINUTES)
    assert abs((booking.hold_expires_at - expected).total_seconds()) < 60


def test_payment_status_is_untouched_by_the_stay(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """The gateway drives the payment exactly as before: a stay does not
    short-circuit, auto-approve or otherwise change its status."""
    popup = _make_popup(db, tenant_a)
    _enable_step(db, popup)
    _, accommodation = _make_inventory(db, popup)
    db.commit()

    response = _purchase(client, popup, tenant_a, [_booking_line(accommodation)])
    assert response.json()["status"] == "pending"

    payment = db.exec(select(Payments).where(Payments.popup_id == popup.id)).first()
    assert payment.status == PaymentStatus.PENDING.value
    assert payment.external_id is not None
