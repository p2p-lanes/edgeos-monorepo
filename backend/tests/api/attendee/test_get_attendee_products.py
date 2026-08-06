"""Tests for GET /attendees/{attendee_id} — typed AttendeeProductPublic response.

Covers FIX #5:
- GET /attendees/{attendee_id} returns products[].check_in_code populated
- GET /attendees/{attendee_id} returns products[].requires_check_in per ticket
- GET /attendees/{attendee_id} returns origin discriminator
- GET /attendees with list endpoint still works (AttendeeListItem shape)
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


def _make_product(
    db: Session, tenant: Tenants, popup: Popups, requires_check_in: bool = True
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"GAP Product {uuid.uuid4().hex[:6]}",
        slug=f"gap-{uuid.uuid4().hex[:6]}",
        price=Decimal("40"),
        category="ticket",
        requires_check_in=requires_check_in,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"gap-{uuid.uuid4().hex[:8]}@test.com",
        first_name="GAP",
        last_name="Test",
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
        name="GAP Test Attendee",
        category="main",
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
        check_in_code=code or f"GAP{uuid.uuid4().hex[:5].upper()}",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGetAttendeeDetail:
    """GET /attendees/{attendee_id} must return products[].check_in_code populated."""

    def test_get_attendee_returns_check_in_code(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """products[].check_in_code must be populated (not None) for a seeded ticket."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        code = f"GAPCHK{uuid.uuid4().hex[:2].upper()}"
        _make_ticket(db, tenant_a, attendee, product, code=code)

        response = client.get(
            f"/api/v1/attendees/{attendee.id}",
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 200, (
            f"Expected 200, got {response.status_code}: {response.text}"
        )
        data = response.json()
        products = data.get("products", [])
        assert len(products) >= 1, (
            "Attendee with one ticket must have products[] non-empty"
        )
        assert products[0]["check_in_code"] == code, (
            f"Expected check_in_code='{code}', got {products[0].get('check_in_code')!r}"
        )

    def test_get_attendee_returns_requires_check_in(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """products[].requires_check_in must match the product-level flag."""
        product = _make_product(db, tenant_a, popup_tenant_a, requires_check_in=True)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        _make_ticket(db, tenant_a, attendee, product)

        response = client.get(
            f"/api/v1/attendees/{attendee.id}",
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 200
        products = response.json()["products"]
        assert len(products) >= 1
        assert products[0]["requires_check_in"] is True, (
            "requires_check_in must be True when product.requires_check_in=True"
        )

    def test_get_attendee_includes_origin(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """Response must include an origin discriminator field."""
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)

        response = client.get(
            f"/api/v1/attendees/{attendee.id}",
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 200
        data = response.json()
        assert "origin" in data, "Response must include 'origin' field"
        assert data["origin"] in ("application", "direct_sale"), (
            f"origin must be 'application' or 'direct_sale', got {data['origin']!r}"
        )

    def test_get_attendee_not_found_returns_404(
        self,
        client: TestClient,
        admin_user_tenant_a: Users,
    ) -> None:
        """GET /attendees/{unknown_id} must return 404."""
        response = client.get(
            f"/api/v1/attendees/{uuid.uuid4()}",
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 404


class TestListAttendeesStillWorks:
    """GET /attendees (list) must still return results with the legacy ProductWithQuantity shape."""

    def test_list_attendees_returns_200(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
    ) -> None:
        """List endpoint still works after schema change."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        _make_ticket(db, tenant_a, attendee, product)

        response = client.get(
            f"/api/v1/attendees?popup_id={popup_tenant_a.id}",
            headers=_auth(admin_user_tenant_a),
        )
        assert response.status_code == 200, (
            f"List attendees must return 200, got {response.status_code}: {response.text}"
        )
        data = response.json()
        assert "results" in data
        assert len(data["results"]) >= 1
