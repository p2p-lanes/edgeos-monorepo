"""HTTP API tests for POST /attendees/check-in/{code} and GET /attendees/tickets/{email}.

TDD phase: RED — written BEFORE the endpoint shift (GET → POST) is implemented.
Closes W1 from verify report #1205.

Addendum #12 spec:
  - POST /attendees/check-in/{code} returns 200 with enriched TicketPublic
    (total_scans, first_scan_at, last_scan_at populated from ticket_events)
  - 404 on unknown code
  - Backend does NOT block re-scans — total_scans increments on each POST
  - Different sources are accepted and stored in payload
  - Two tickets with separate codes have independent counters
  - GET /attendees/tickets/{email} returns per-ticket entries (no quantity aggregation)
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.attendee.models import AttendeeProducts, Attendees
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
        name=f"Check-In HTTP Product {uuid.uuid4().hex[:6]}",
        slug=f"ci-http-{uuid.uuid4().hex[:6]}",
        price=Decimal("30"),
        category="ticket",
        requires_check_in=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"ci-http-{uuid.uuid4().hex[:8]}@test.com",
        first_name="CheckIn",
        last_name="HTTP",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_attendee(db: Session, tenant: Tenants, popup: Popups, human: Humans) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        name="CheckIn HTTP Attendee",
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
        check_in_code=code or f"CI{uuid.uuid4().hex[:6].upper()}",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


# ---------------------------------------------------------------------------
# POST /attendees/check-in/{code} tests
# ---------------------------------------------------------------------------


class TestPostCheckIn:
    """POST /attendees/check-in/{code} — check-in with event log."""

    def test_first_scan_returns_200_with_total_scans_1(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """First scan: 200, total_scans=1, first_scan_at and last_scan_at are set."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        code = f"FIRST{uuid.uuid4().hex[:3].upper()}"
        _make_ticket(db, tenant_a, attendee, product, code=code)

        response = client.post(
            f"/api/v1/attendees/check-in/{code}",
            json={"source": "qr"},
            headers=_auth(admin_user_tenant_a),
        )

        assert response.status_code == 200, (
            f"Expected 200, got {response.status_code}: {response.text}"
        )
        data = response.json()
        assert data["check_in_code"] == code
        assert data["total_scans"] == 1, f"Expected total_scans=1, got {data['total_scans']}"
        assert data["first_scan_at"] is not None, "first_scan_at must be set after first scan"
        assert data["last_scan_at"] is not None, "last_scan_at must be set after first scan"
        assert data["is_rescan"] is False, "First scan must not be flagged as a re-scan"

    def test_rescan_returns_200_with_incremented_total(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """Re-scan: 200, total_scans=2, first_scan_at unchanged, last_scan_at updated."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        code = f"RESCAN{uuid.uuid4().hex[:2].upper()}"
        _make_ticket(db, tenant_a, attendee, product, code=code)

        headers = _auth(admin_user_tenant_a)

        # First scan
        r1 = client.post(
            f"/api/v1/attendees/check-in/{code}",
            json={"source": "qr"},
            headers=headers,
        )
        assert r1.status_code == 200
        data1 = r1.json()
        assert data1["is_rescan"] is False, "First scan must not be flagged as a re-scan"

        # Second scan
        r2 = client.post(
            f"/api/v1/attendees/check-in/{code}",
            json={"source": "manual"},
            headers=headers,
        )
        assert r2.status_code == 200, f"Re-scan must return 200, got {r2.status_code}: {r2.text}"
        data2 = r2.json()

        assert data2["total_scans"] == 2, (
            f"Expected total_scans=2 after re-scan, got {data2['total_scans']}"
        )
        assert data2["is_rescan"] is True, "Re-scan must be flagged via is_rescan=true"
        assert data2["first_scan_at"] is not None
        assert data2["last_scan_at"] is not None
        # first_scan_at must equal the first scan (or be earlier)
        assert data1["first_scan_at"] == data2["first_scan_at"], (
            "first_scan_at must not change on re-scan"
        )

    def test_non_scannable_product_returns_400(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """POST with a code from a `requires_check_in=False` product returns 400."""
        product = Products(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            name=f"Non-Scannable {uuid.uuid4().hex[:6]}",
            slug=f"ns-{uuid.uuid4().hex[:6]}",
            price=Decimal("10"),
            category="merch",
            requires_check_in=False,
        )
        db.add(product)
        db.commit()
        db.refresh(product)

        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        code = f"NOSCAN{uuid.uuid4().hex[:2].upper()}"
        _make_ticket(db, tenant_a, attendee, product, code=code)

        response = client.post(
            f"/api/v1/attendees/check-in/{code}",
            json={"source": "qr"},
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 400, (
            f"Expected 400 for non-scannable product, got {response.status_code}: {response.text}"
        )
        assert "does not require check-in" in response.json()["detail"].lower(), (
            f"Expected detail to mention non-scannable; got {response.json()['detail']!r}"
        )

    def test_unknown_code_returns_404(
        self,
        client: TestClient,
        admin_user_tenant_a: Users,
    ) -> None:
        """POST with unknown check_in_code returns 404."""
        response = client.post(
            "/api/v1/attendees/check-in/UNKNOWN99",
            json={"source": "qr"},
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 404, (
            f"Expected 404 for unknown code, got {response.status_code}: {response.text}"
        )

    def test_different_source_stored_in_payload(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """POST with source='manual' stores that source in ticket_events.payload."""
        from sqlmodel import select

        from app.api.ticket_event.models import TicketEvent

        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        code = f"MANUAL{uuid.uuid4().hex[:2].upper()}"
        ticket = _make_ticket(db, tenant_a, attendee, product, code=code)

        response = client.post(
            f"/api/v1/attendees/check-in/{code}",
            json={"source": "manual", "notes": "Staff override"},
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 200

        # Verify the event was stored with correct payload
        event = db.exec(
            select(TicketEvent)
            .where(TicketEvent.attendee_product_id == ticket.id)
            .order_by(TicketEvent.occurred_at.desc())  # type: ignore[union-attr]
        ).first()
        assert event is not None, "TicketEvent must be created after POST check-in"
        assert event.payload is not None
        assert event.payload["source"] == "manual"
        assert event.payload["notes"] == "Staff override"

    def test_two_tickets_independent_counters(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """Two tickets with separate codes have independent check-in counters."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        code_a = f"ISOLA{uuid.uuid4().hex[:3].upper()}"
        code_b = f"ISOLB{uuid.uuid4().hex[:3].upper()}"
        _make_ticket(db, tenant_a, attendee, product, code=code_a)
        _make_ticket(db, tenant_a, attendee, product, code=code_b)

        headers = _auth(admin_user_tenant_a)

        # Scan ticket_a twice
        client.post(
            f"/api/v1/attendees/check-in/{code_a}",
            json={"source": "qr"},
            headers=headers,
        )
        r2 = client.post(
            f"/api/v1/attendees/check-in/{code_a}",
            json={"source": "qr"},
            headers=headers,
        )
        assert r2.json()["total_scans"] == 2, "ticket_a must have 2 scans"

        # Scan ticket_b once
        rb = client.post(
            f"/api/v1/attendees/check-in/{code_b}",
            json={"source": "qr"},
            headers=headers,
        )
        assert rb.status_code == 200
        assert rb.json()["total_scans"] == 1, "ticket_b counter must be independent (1 scan)"


# ---------------------------------------------------------------------------
# GET /attendees/tickets/{email} tests
# ---------------------------------------------------------------------------


class TestGetTicketsByEmail:
    """GET /attendees/tickets/{email} must return per-ticket entries."""

    def test_tickets_per_ticket_not_aggregated(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """2 AttendeeProducts rows for one attendee → 2 TicketProduct entries in response."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        email = human.email
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)

        # Create 2 tickets for the same attendee + product (always-INSERT)
        _make_ticket(db, tenant_a, attendee, product)
        _make_ticket(db, tenant_a, attendee, product)

        response = client.get(
            f"/api/v1/attendees/tickets/{email}",
            headers=_auth(admin_user_tenant_a),
        )

        assert response.status_code == 200, (
            f"Expected 200, got {response.status_code}: {response.text}"
        )
        data = response.json()
        assert isinstance(data, list)

        # Find the attendee entry in response
        attendee_entries = [item for item in data if item["id"] == str(attendee.id)]
        assert len(attendee_entries) == 1, "Attendee must appear exactly once"

        products = attendee_entries[0]["products"]
        assert len(products) == 2, (
            f"Expected 2 per-ticket entries (no aggregation), got {len(products)}"
        )
        for p in products:
            assert p["quantity"] == 1, f"Each ticket must have quantity=1, got {p['quantity']}"
