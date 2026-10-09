"""GET /check-ins: unit context, free-text search and the shared filter group.

Covers the scan history the backoffice uses to follow merch pickups:
- ownerless units (merch with no participant) expose the buyer, code,
  category, "unit N of M" and the sales flow they were sold through
- search matches buyer name/email and check-in codes
- product_category / has_attendee / source / sales_flow_id / product_id
  conditions, combined with the popup scope
- malformed filters return 422
"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.check_in.crud import record_check_in
from app.api.check_in.schemas import CheckInPayload
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token
from tests._flow_helpers import application_flow_id
from tests.api.payment.test_product_unit_materialization import (
    _product,
    _purchase,
    _units,
)


def _auth(user: Users) -> dict[str, str]:
    token = create_access_token(subject=user.id, token_type="user")
    return {"Authorization": f"Bearer {token}"}


def _popup(db: Session, tenant: Tenants) -> Popups:
    now = datetime.now(UTC)
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Scan Filters {uuid.uuid4().hex[:6]}",
        slug=f"scan-filters-{uuid.uuid4().hex[:8]}",
        start_date=now + timedelta(days=1),
        end_date=now + timedelta(days=5),
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    application_flow_id(db, popup.id)
    return popup


def _buyer(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"merch-buyer-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Merch",
        last_name=f"Buyer{uuid.uuid4().hex[:4]}",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _second_flow(db: Session, popup: Popups) -> SalesFlows:
    slug = f"merch-desk-{uuid.uuid4().hex[:6]}"
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=slug,
        name="Merch desk",
        type=SaleType.direct.value,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _merch_units(
    db: Session,
    popup: Popups,
    buyer: Humans,
    *,
    quantity: int,
    sales_flow_id: uuid.UUID | None = None,
) -> tuple[Products, list[AttendeeProducts]]:
    """Approve a merch purchase so fulfillment mints its ownerless units."""
    product = _product(db, popup, category="merch", requires_check_in=True)
    payment, _line = _purchase(db, popup, product, quantity=quantity)
    payment.buyer_human_id = buyer.id
    payment.sales_flow_id = sales_flow_id
    db.add(payment)
    db.commit()
    payments_crud.approve_payment(db, payment.id)
    return product, _units(db, payment)


def _ticket(db: Session, popup: Popups) -> AttendeeProducts:
    """A participant ticket with no payment, so it carries no sales flow."""
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Scan Pass {uuid.uuid4().hex[:6]}",
        slug=f"scan-pass-{uuid.uuid4().hex[:8]}",
        price=Decimal("50"),
        category="ticket",
        requires_check_in=True,
    )
    db.add(product)
    db.flush()
    attendee = Attendees(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="Pass Holder",
        category="main",
        email=f"pass-holder-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(attendee)
    db.flush()
    ticket = AttendeeProducts(
        tenant_id=popup.tenant_id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=f"PS{uuid.uuid4().hex[:6].upper()}",
        product_category_snapshot="ticket",
        requires_check_in_snapshot=True,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


def _scan(
    db: Session, popup: Popups, unit: AttendeeProducts, source: str = "qr"
) -> None:
    record_check_in(
        db,
        unit.id,
        popup_id=popup.id,
        payload=CheckInPayload(source=source),  # type: ignore[arg-type]
        actor_user_id=None,
    )


def _list(
    client: TestClient,
    user: Users,
    popup: Popups,
    *,
    conditions: list[dict] | None = None,
    match: str = "all",
    search: str | None = None,
):
    params: dict[str, str] = {"popup_id": str(popup.id)}
    if conditions is not None:
        params["filters"] = json.dumps({"match": match, "conditions": conditions})
    if search is not None:
        params["search"] = search
    return client.get("/api/v1/check-ins", params=params, headers=_auth(user))


def _codes(response) -> list[str]:
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["paging"]["total"] == len(body["results"])
    return sorted(row["check_in_code"] for row in body["results"])


class TestScanHistoryUnitContext:
    def test_ownerless_merch_row_identifies_buyer_unit_and_flow(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup = _popup(db, tenant_a)
        buyer = _buyer(db, tenant_a)
        flow = _second_flow(db, popup)
        product, units = _merch_units(
            db, popup, buyer, quantity=2, sales_flow_id=flow.id
        )
        _scan(db, popup, units[1])

        response = _list(client, admin_user_tenant_a, popup)

        assert response.status_code == 200, response.text
        [row] = response.json()["results"]
        assert row["attendee_name"] is None
        assert row["buyer_name"] == buyer.display_name
        assert row["buyer_email"] == buyer.email
        assert row["product_name"] == product.name
        assert row["product_category"] == "merch"
        assert row["check_in_code"] == units[1].check_in_code
        assert (row["unit_index"], row["unit_count"]) == (1, 2)
        assert row["sales_flow_id"] == str(flow.id)
        assert row["sales_flow_name"] == "Merch desk"

    def test_ticket_row_keeps_attendee_and_has_no_flow(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup = _popup(db, tenant_a)
        ticket = _ticket(db, popup)
        _scan(db, popup, ticket)

        [row] = _list(client, admin_user_tenant_a, popup).json()["results"]

        assert row["attendee_name"] == "Pass Holder"
        assert row["buyer_email"] is None
        assert row["product_category"] == "ticket"
        assert row["unit_index"] is None
        assert row["sales_flow_id"] is None


class TestScanHistoryFilters:
    def _scenario(self, db: Session, tenant: Tenants):
        popup = _popup(db, tenant)
        buyer = _buyer(db, tenant)
        flow = _second_flow(db, popup)
        merch_product, merch = _merch_units(
            db, popup, buyer, quantity=1, sales_flow_id=flow.id
        )
        ticket = _ticket(db, popup)
        _scan(db, popup, merch[0])
        _scan(db, popup, ticket, source="manual")
        return popup, buyer, flow, merch_product, merch[0], ticket

    def test_product_category_eq_and_neq(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup, _buyer_, _flow, _product_, merch, ticket = self._scenario(db, tenant_a)

        only_merch = _list(
            client,
            admin_user_tenant_a,
            popup,
            conditions=[{"field": "product_category", "op": "eq", "value": "merch"}],
        )
        not_merch = _list(
            client,
            admin_user_tenant_a,
            popup,
            conditions=[{"field": "product_category", "op": "neq", "value": "merch"}],
        )

        assert _codes(only_merch) == [merch.check_in_code]
        assert _codes(not_merch) == [ticket.check_in_code]

    def test_has_attendee_false_keeps_ownerless_units(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup, _buyer_, _flow, _product_, merch, _ticket_ = self._scenario(db, tenant_a)

        response = _list(
            client,
            admin_user_tenant_a,
            popup,
            conditions=[{"field": "has_attendee", "op": "eq", "value": False}],
        )

        assert _codes(response) == [merch.check_in_code]

    def test_sales_flow_eq_neq_and_empty(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup, _buyer_, flow, _product_, merch, ticket = self._scenario(db, tenant_a)

        def by_flow(op: str, value: str | None = None):
            condition = {"field": "sales_flow_id", "op": op}
            if value is not None:
                condition["value"] = value
            return _codes(
                _list(client, admin_user_tenant_a, popup, conditions=[condition])
            )

        assert by_flow("eq", str(flow.id)) == [merch.check_in_code]
        # neq also keeps units with no flow, like every other nullable field.
        assert by_flow("neq", str(flow.id)) == [ticket.check_in_code]
        assert by_flow("is_empty") == [ticket.check_in_code]
        assert by_flow("not_empty") == [merch.check_in_code]

    def test_source_and_product_conditions_combine(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup, _buyer_, _flow, merch_product, merch, ticket = self._scenario(
            db, tenant_a
        )

        manual = _list(
            client,
            admin_user_tenant_a,
            popup,
            conditions=[{"field": "source", "op": "eq", "value": "manual"}],
        )
        either = _list(
            client,
            admin_user_tenant_a,
            popup,
            match="any",
            conditions=[
                {"field": "source", "op": "eq", "value": "manual"},
                {"field": "product_id", "op": "eq", "value": str(merch_product.id)},
            ],
        )

        assert _codes(manual) == [ticket.check_in_code]
        assert _codes(either) == sorted([merch.check_in_code, ticket.check_in_code])

    def test_search_matches_buyer_and_code(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup, buyer, _flow, _product_, merch, ticket = self._scenario(db, tenant_a)

        by_email = _list(client, admin_user_tenant_a, popup, search=buyer.email)
        by_full_name = _list(
            client, admin_user_tenant_a, popup, search=buyer.display_name.upper()
        )
        by_code = _list(
            client, admin_user_tenant_a, popup, search=ticket.check_in_code.lower()
        )
        literal = _list(client, admin_user_tenant_a, popup, search="%")

        assert _codes(by_email) == [merch.check_in_code]
        assert _codes(by_full_name) == [merch.check_in_code]
        assert _codes(by_code) == [ticket.check_in_code]
        assert _codes(literal) == []

    def test_unknown_field_returns_422(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup = _popup(db, tenant_a)

        response = _list(
            client,
            admin_user_tenant_a,
            popup,
            conditions=[{"field": "buyer_human_id", "op": "eq", "value": "x"}],
        )

        assert response.status_code == 422
        assert "buyer_human_id" in response.json()["detail"]
