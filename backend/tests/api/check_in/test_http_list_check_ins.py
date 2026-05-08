"""HTTP API tests for GET /check-ins endpoint.

Covers:
- list returns rows (basic smoke test)
- filter by attendee_product_id works
- filter by popup_id works
- order is descended by occurred_at
- tenant scoping: tenant_b cannot see tenant_a events
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.check_in.schemas import CheckInPayload
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _auth(user: Users) -> dict[str, str]:
    token = create_access_token(subject=user.id, token_type="user")
    return {"Authorization": f"Bearer {token}"}


def _make_product(db: Session, tenant: Tenants, popup: Popups) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"TE-HTTP Product {uuid.uuid4().hex[:6]}",
        slug=f"te-http-{uuid.uuid4().hex[:6]}",
        price=Decimal("25"),
        category="ticket",
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"te-http-{uuid.uuid4().hex[:8]}@test.com",
        first_name="TE",
        last_name="HTTP",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_attendee(
    db: Session, tenant: Tenants, popup: Popups, human: Humans
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        name="TE HTTP Attendee",
        category="main",
        check_in_code=None,
        email=human.email,
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_ticket(
    db: Session,
    tenant: Tenants,
    attendee: Attendees,
    product: Products,
    code: str | None = None,
) -> AttendeeProducts:
    ticket = AttendeeProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=code or f"TE{uuid.uuid4().hex[:6].upper()}",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


def _record_check_in(db: Session, ticket: AttendeeProducts) -> None:
    from app.api.check_in.crud import record_check_in

    # Derive popup_id from the ticket's attendee so callers don't have to
    # plumb it through. Mirrors what the real endpoint does post-validation.
    attendee = db.get(Attendees, ticket.attendee_id)
    assert attendee is not None
    record_check_in(
        db,
        ticket.id,
        popup_id=attendee.popup_id,
        payload=CheckInPayload(source="qr"),
        actor_user_id=None,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestListCheckIns:
    """GET /ticket-events — basic listing and pagination."""

    def test_list_returns_rows(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """After recording a check-in, GET /ticket-events returns at least one row."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        ticket = _make_ticket(db, tenant_a, attendee, product)
        _record_check_in(db, ticket)

        response = client.get(
            "/api/v1/check-ins",
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 200, (
            f"Expected 200, got {response.status_code}: {response.text}"
        )
        data = response.json()
        assert "results" in data
        assert "paging" in data
        assert len(data["results"]) >= 1

    def test_list_row_has_expected_fields(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """Each result row must have id, attendee_product_id, occurred_at, plus enriched fields."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        ticket = _make_ticket(db, tenant_a, attendee, product)
        _record_check_in(db, ticket)

        response = client.get(
            f"/api/v1/check-ins?attendee_product_id={ticket.id}",
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 200
        rows = response.json()["results"]
        assert len(rows) >= 1
        row = rows[0]
        assert "id" in row
        assert "attendee_product_id" in row
        assert "occurred_at" in row
        assert "attendee_name" in row
        assert "product_name" in row

    def test_filter_by_attendee_product_id(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """Filter by attendee_product_id returns only events for that ticket."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        ticket_a = _make_ticket(db, tenant_a, attendee, product)
        ticket_b = _make_ticket(db, tenant_a, attendee, product)

        _record_check_in(db, ticket_a)
        _record_check_in(db, ticket_b)

        response = client.get(
            f"/api/v1/check-ins?attendee_product_id={ticket_a.id}",
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 200
        rows = response.json()["results"]
        assert all(r["attendee_product_id"] == str(ticket_a.id) for r in rows), (
            "All returned events must be for ticket_a only"
        )

    def test_filter_by_popup_id(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        popup_tenant_a_summer_fest: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """Filter by popup_id returns only events for tickets in that popup."""
        product_a = _make_product(db, tenant_a, popup_tenant_a)
        product_sf = _make_product(db, tenant_a, popup_tenant_a_summer_fest)

        human = _make_human(db, tenant_a)
        attendee_a = _make_attendee(db, tenant_a, popup_tenant_a, human)
        attendee_sf = _make_attendee(db, tenant_a, popup_tenant_a_summer_fest, human)

        ticket_a = _make_ticket(db, tenant_a, attendee_a, product_a)
        ticket_sf = _make_ticket(db, tenant_a, attendee_sf, product_sf)

        _record_check_in(db, ticket_a)
        _record_check_in(db, ticket_sf)

        response = client.get(
            f"/api/v1/check-ins?popup_id={popup_tenant_a.id}",
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 200
        rows = response.json()["results"]
        # All rows must be for tickets in popup_tenant_a (not summer_fest)
        returned_ap_ids = {r["attendee_product_id"] for r in rows}
        assert str(ticket_a.id) in returned_ap_ids, (
            "ticket_a events must appear when filtering by popup_tenant_a"
        )
        assert str(ticket_sf.id) not in returned_ap_ids, (
            "ticket_sf events must NOT appear when filtering by popup_tenant_a"
        )

    def test_order_is_descending(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """Events are ordered by occurred_at DESC."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        # Record two check-ins to get distinct occurred_at values
        _record_check_in(db, ticket)
        _record_check_in(db, ticket)

        response = client.get(
            f"/api/v1/check-ins?attendee_product_id={ticket.id}",
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 200
        rows = response.json()["results"]
        if len(rows) >= 2:
            times = [r["occurred_at"] for r in rows]
            assert times[0] >= times[-1], "Events must be ordered DESC by occurred_at"

    def test_tenant_scoping_enforced(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        tenant_b: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
        admin_user_tenant_b: Users,
    ) -> None:
        """Tenant B cannot see events created for tenant A tickets."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        ticket = _make_ticket(db, tenant_a, attendee, product)
        _record_check_in(db, ticket)

        # Tenant B user queries for all events — must not see tenant A events
        response = client.get(
            f"/api/v1/check-ins?attendee_product_id={ticket.id}",
            headers=_auth(admin_user_tenant_b),
        )
        assert response.status_code == 200
        rows = response.json()["results"]
        assert len(rows) == 0, "Tenant B must not see events for tenant A tickets"
