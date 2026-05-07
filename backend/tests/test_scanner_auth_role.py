"""Tests for scanner-auth-role change (PR1 slice).

TDD cycle — this file grows RED first, then GREEN as implementations land.

Covers:
- CurrentCheckInOperator dep rejects VIEWER, accepts ADMIN and CHECK_IN_CONTROLLER
- POST /auth/scanner/login and POST /auth/scanner/authenticate endpoints
- POST /auth/user/authenticate rejects CHECK_IN_CONTROLLER (still accepts ADMIN)
- ROLE_HIERARCHY: ADMIN can create CHECK_IN_CONTROLLER, controller cannot create users
- get_tenant_session resolves CRUD (not READONLY) for CHECK_IN_CONTROLLER
- /users/me still accessible to all authenticated roles
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.redis import auth_code_store, is_redis_available
from tests._role_assertions import assert_authorized, assert_forbidden

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_product(db: Session, tenant: Tenants, popup: Popups) -> Products:
    from decimal import Decimal

    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"SAR Product {uuid.uuid4().hex[:6]}",
        slug=f"sar-{uuid.uuid4().hex[:6]}",
        price=Decimal("10"),
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
        email=f"sar-{uuid.uuid4().hex[:8]}@test.com",
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
        name="SAR Attendee",
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
        check_in_code=code or f"SAR{uuid.uuid4().hex[:6].upper()}",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


def _seed_otp(user: Users, code: str = "123456") -> None:
    """Seed an OTP for a user directly via the auth_code_store (Redis)."""
    if is_redis_available():
        auth_code_store.store_user_code(user.id, code)
    else:
        pytest.skip("OTP seeding requires Redis; Redis not available in this environment")


# ---------------------------------------------------------------------------
# T4.RED — CurrentCheckInOperator dep rejects VIEWER on check-in route
# (FAILS until T5.GREEN adds the dep and T10.GREEN re-gates the route)
# ---------------------------------------------------------------------------


class TestCheckInOperatorDepRejectsViewer:
    """VIEWER must receive 403 on routes gated by CurrentCheckInOperator."""

    def test_check_in_operator_dep_rejects_viewer_on_check_in(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER token → POST /attendees/check-in/{code} → 403 (route re-gated)."""
        assert_forbidden(
            client,
            "POST",
            "/api/v1/attendees/check-in/SARTEST001",
            viewer_token_tenant_a,
            json={"source": "qr"},
        )


# ---------------------------------------------------------------------------
# T6.RED — auth CRUD: role rejection tests for user/authenticate and scanner/*
# (FAILS until T7.GREEN adds allowed_roles to authenticate_user and
#  T8.GREEN adds scanner endpoints + re-gates user/authenticate)
# ---------------------------------------------------------------------------


class TestAuthRoleRejection:
    """Role gating at the authenticate step."""

    def test_user_authenticate_rejects_check_in_controller(
        self,
        client: TestClient,
        check_in_controller_user_tenant_a: Users,
    ) -> None:
        """CHECK_IN_CONTROLLER user gets 403 from POST /auth/user/authenticate even with valid OTP."""
        _seed_otp(check_in_controller_user_tenant_a, "111111")
        # auth/user/authenticate is unauthenticated — no Bearer token needed
        response = client.post(
            "/api/v1/auth/user/authenticate",
            json={"email": check_in_controller_user_tenant_a.email, "code": "111111"},
        )
        assert response.status_code == 403, (
            f"CHECK_IN_CONTROLLER must get 403 at /auth/user/authenticate, "
            f"got {response.status_code}: {response.text}"
        )

    def test_user_authenticate_accepts_admin(
        self,
        client: TestClient,
        admin_user_tenant_a: Users,
    ) -> None:
        """ADMIN user still gets 200 from POST /auth/user/authenticate with valid OTP."""
        _seed_otp(admin_user_tenant_a, "222222")
        response = client.post(
            "/api/v1/auth/user/authenticate",
            json={"email": admin_user_tenant_a.email, "code": "222222"},
        )
        assert response.status_code == 200, (
            f"ADMIN must still be accepted at /auth/user/authenticate, "
            f"got {response.status_code}: {response.text}"
        )
        assert "access_token" in response.json()

    def test_scanner_authenticate_rejects_viewer(
        self,
        client: TestClient,
        viewer_user_tenant_a: Users,
    ) -> None:
        """VIEWER gets 403 from POST /auth/scanner/authenticate even with valid OTP."""
        _seed_otp(viewer_user_tenant_a, "333333")
        response = client.post(
            "/api/v1/auth/scanner/authenticate",
            json={"email": viewer_user_tenant_a.email, "code": "333333"},
        )
        assert response.status_code == 403, (
            f"VIEWER must get 403 at /auth/scanner/authenticate, "
            f"got {response.status_code}: {response.text}"
        )

    def test_scanner_authenticate_accepts_check_in_controller(
        self,
        client: TestClient,
        check_in_controller_user_tenant_a: Users,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 200 + access_token from POST /auth/scanner/authenticate."""
        _seed_otp(check_in_controller_user_tenant_a, "444444")
        response = client.post(
            "/api/v1/auth/scanner/authenticate",
            json={
                "email": check_in_controller_user_tenant_a.email,
                "code": "444444",
            },
        )
        assert response.status_code == 200, (
            f"CHECK_IN_CONTROLLER must be accepted at /auth/scanner/authenticate, "
            f"got {response.status_code}: {response.text}"
        )
        assert "access_token" in response.json()

    def test_user_login_rejects_check_in_controller_pre_otp(
        self,
        client: TestClient,
        check_in_controller_user_tenant_a: Users,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 from POST /auth/user/login BEFORE OTP is generated.

        Pre-OTP gating: the scanner role must not even receive the email — we
        reject at the login step, not at authenticate. UX requirement: users
        must not have to wait for an OTP they can never use.
        """
        response = client.post(
            "/api/v1/auth/user/login",
            json={"email": check_in_controller_user_tenant_a.email},
        )
        assert response.status_code == 403, (
            f"CHECK_IN_CONTROLLER must be rejected at /auth/user/login PRE-OTP, "
            f"got {response.status_code}: {response.text}"
        )

    def test_scanner_login_rejects_viewer_pre_otp(
        self,
        client: TestClient,
        viewer_user_tenant_a: Users,
    ) -> None:
        """VIEWER gets 403 from POST /auth/scanner/login BEFORE OTP is generated."""
        response = client.post(
            "/api/v1/auth/scanner/login",
            json={"email": viewer_user_tenant_a.email},
        )
        assert response.status_code == 403, (
            f"VIEWER must be rejected at /auth/scanner/login PRE-OTP, "
            f"got {response.status_code}: {response.text}"
        )


# ---------------------------------------------------------------------------
# T9.RED — scanner route re-gating tests
# (FAILS until T10.GREEN + T11.GREEN re-gate the routes)
# ---------------------------------------------------------------------------


class TestScannerRouteReGating:
    """Scanner routes must accept CHECK_IN_CONTROLLER and reject VIEWER."""

    def test_check_in_operator_dep_accepts_controller_on_check_in(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        check_in_controller_user_tenant_a: Users,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER can scan (POST /attendees/check-in/{code}), response is not 403."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        code = f"CTRL{uuid.uuid4().hex[:4].upper()}"
        _make_ticket(db, tenant_a, attendee, product, code=code)

        response = client.post(
            f"/api/v1/attendees/check-in/{code}",
            json={"source": "qr"},
            headers={"Authorization": f"Bearer {check_in_controller_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"CHECK_IN_CONTROLLER must not get 403 on check-in, "
            f"got {response.status_code}: {response.text}"
        )

    def test_check_in_operator_dep_accepts_admin_on_check_in(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_user_tenant_a: Users,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN can still scan (POST /attendees/check-in/{code}) after re-gating."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        code = f"ADMA{uuid.uuid4().hex[:4].upper()}"
        _make_ticket(db, tenant_a, attendee, product, code=code)

        assert_authorized(
            client,
            "POST",
            f"/api/v1/attendees/check-in/{code}",
            admin_token_tenant_a,
            json={"source": "qr"},
        )

    def test_check_in_controller_can_list_attendees(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER can GET /attendees (response is not 403)."""
        response = client.get(
            "/api/v1/attendees",
            headers={"Authorization": f"Bearer {check_in_controller_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"CHECK_IN_CONTROLLER must not get 403 on GET /attendees, "
            f"got {response.status_code}: {response.text}"
        )

    def test_viewer_cannot_list_attendees(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /attendees (re-gated to CurrentCheckInOperator)."""
        assert_forbidden(
            client,
            "GET",
            "/api/v1/attendees",
            viewer_token_tenant_a,
        )

    def test_check_in_controller_can_list_ticket_events(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER can GET /ticket-events (response is not 403)."""
        response = client.get(
            "/api/v1/ticket-events",
            headers={"Authorization": f"Bearer {check_in_controller_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"CHECK_IN_CONTROLLER must not get 403 on GET /ticket-events, "
            f"got {response.status_code}: {response.text}"
        )

    def test_viewer_cannot_list_ticket_events(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /ticket-events (re-gated to CurrentCheckInOperator)."""
        assert_forbidden(
            client,
            "GET",
            "/api/v1/ticket-events",
            viewer_token_tenant_a,
        )


# ---------------------------------------------------------------------------
# T12.RED — admin-only route tests (for PR1: only POST /users matters)
# (FAILS until T13.GREEN re-gates POST /users to CurrentAdmin)
# ---------------------------------------------------------------------------


class TestAdminOnlyRoutes:
    """Non-scanner routes must reject CHECK_IN_CONTROLLER."""

    def test_check_in_controller_cannot_create_users(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on POST /users (re-gated to CurrentAdmin)."""
        assert_forbidden(
            client,
            "POST",
            "/api/v1/users",
            check_in_controller_token_tenant_a,
            json={
                "email": f"newuser-{uuid.uuid4().hex[:6]}@test.com",
                "role": "viewer",
            },
        )


# ---------------------------------------------------------------------------
# T17.RED — ROLE_HIERARCHY + tenant session + /users/me tests
# (FAILS until T16.GREEN extends ROLE_HIERARCHY)
# ---------------------------------------------------------------------------


class TestRoleHierarchyAndSession:
    """ROLE_HIERARCHY extension and ancillary behavior."""

    def test_role_hierarchy_admin_can_create_check_in_controller(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN can POST /users with role=check_in_controller → 201."""
        response = client.post(
            "/api/v1/users",
            json={
                "email": f"new-ctrl-{uuid.uuid4().hex[:6]}@test.com",
                "role": "check_in_controller",
            },
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code == 201, (
            f"ADMIN must be able to create check_in_controller user, "
            f"got {response.status_code}: {response.text}"
        )
        assert response.json()["role"] == "check_in_controller"

    def test_role_hierarchy_check_in_controller_cannot_create_users(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on POST /users (dep rejects before hierarchy)."""
        assert_forbidden(
            client,
            "POST",
            "/api/v1/users",
            check_in_controller_token_tenant_a,
            json={
                "email": f"attempt-{uuid.uuid4().hex[:6]}@test.com",
                "role": "viewer",
            },
        )

    def test_get_tenant_session_resolves_crud_for_controller(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        check_in_controller_user_tenant_a: Users,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER scan must not fail with 'Tenant credentials not configured'.

        get_tenant_session must resolve CRUD (not READONLY) for CHECK_IN_CONTROLLER.
        A 200 or 404 response proves CRUD credentials were used; a 403 with the
        'Tenant credentials not configured' detail would prove READONLY was used.
        """
        product = _make_product(db, tenant_a, popup_tenant_a)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a, human)
        code = f"CRUD{uuid.uuid4().hex[:4].upper()}"
        _make_ticket(db, tenant_a, attendee, product, code=code)

        response = client.post(
            f"/api/v1/attendees/check-in/{code}",
            json={"source": "qr"},
            headers={"Authorization": f"Bearer {check_in_controller_token_tenant_a}"},
        )
        # 200 means write succeeded; 404 means code not found — both are acceptable.
        # 403 with tenant-credentials detail means READONLY was wrongly used.
        assert response.status_code in (200, 404, 422), (
            f"Expected 200/404/422, got {response.status_code}: {response.text}"
        )
        if response.status_code == 403:
            detail = response.json().get("detail", "")
            assert "Tenant credentials not configured" not in detail, (
                "CHECK_IN_CONTROLLER must use CRUD credentials, not READONLY"
            )

    def test_any_authenticated_user_can_reach_users_me(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
        viewer_token_tenant_a: str,
    ) -> None:
        """Both CHECK_IN_CONTROLLER and VIEWER can GET /users/me (stays on CurrentUser)."""
        assert_authorized(
            client,
            "GET",
            "/api/v1/users/me",
            check_in_controller_token_tenant_a,
        )
        assert_authorized(
            client,
            "GET",
            "/api/v1/users/me",
            viewer_token_tenant_a,
        )
