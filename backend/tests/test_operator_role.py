"""Tests for the OPERATOR role.

OPERATOR sits between ADMIN and VIEWER. Operators can run day-to-day operations
on the product (events, popups, products, coupons, email templates, reviews,
invitations, attendees, refunds, API keys) but cannot touch structural settings
(admin users, approval strategies, event_settings, base_field_configs) and cannot
manage their own peers or anyone above them in the hierarchy.

These tests use the assert_authorized / assert_forbidden helpers established
in _role_assertions.py.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.shared.enums import UserRole
from app.api.user.models import Users
from app.core.security import create_access_token
from tests._role_assertions import assert_authorized, assert_forbidden


# ---------------------------------------------------------------------------
# OPERATOR is authorized on operational routes (CRUD on products, events, etc.)
# ---------------------------------------------------------------------------


class TestOperatorAuthorizedOnOperationalRoutes:
    """OPERATOR is in the allow-list for operational read/write routes."""

    def test_operator_can_list_events(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        assert_authorized(client, "GET", "/api/v1/events", operator_token_tenant_a)

    def test_operator_can_list_applications(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        assert_authorized(
            client, "GET", "/api/v1/applications", operator_token_tenant_a
        )

    def test_operator_can_get_dashboard_stats(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        response = client.get(
            "/api/v1/dashboard/stats?popup_id=" + str(uuid.uuid4()),
            headers={"Authorization": f"Bearer {operator_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"OPERATOR must not get 403 on GET /dashboard/stats, "
            f"got {response.status_code}: {response.text}"
        )

    def test_operator_can_list_reviews(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        response = client.get(
            f"/api/v1/applications/{uuid.uuid4()}/reviews",
            headers={"Authorization": f"Bearer {operator_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"OPERATOR must not get 403 on GET /applications/{{id}}/reviews, "
            f"got {response.status_code}: {response.text}"
        )

    def test_operator_can_bulk_invite(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        response = client.post(
            f"/api/v1/events/{uuid.uuid4()}/invitations",
            headers={"Authorization": f"Bearer {operator_token_tenant_a}"},
            json={"emails": ["test@test.com"]},
        )
        # 404 acceptable (event doesn't exist); what matters is NOT 403
        assert response.status_code != 403, (
            f"OPERATOR must not get 403 on POST /events/{{id}}/invitations, "
            f"got {response.status_code}: {response.text}"
        )


# ---------------------------------------------------------------------------
# OPERATOR is forbidden on structural / SUPERADMIN-only routes
# ---------------------------------------------------------------------------


class TestOperatorForbiddenOnStructuralRoutes:
    """OPERATOR is NOT in the allow-list for approval strategy, event settings,
    base field configs, or any superadmin-only route."""

    def test_operator_cannot_create_approval_strategy(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        assert_forbidden(
            client,
            "POST",
            f"/api/v1/popups/{uuid.uuid4()}/approval-strategy",
            operator_token_tenant_a,
            json={"strategy_type": "single_reviewer"},
        )

    def test_operator_cannot_patch_approval_strategy(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        assert_forbidden(
            client,
            "PATCH",
            f"/api/v1/popups/{uuid.uuid4()}/approval-strategy",
            operator_token_tenant_a,
            json={"strategy_type": "single_reviewer"},
        )

    def test_operator_cannot_delete_approval_strategy(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        assert_forbidden(
            client,
            "DELETE",
            f"/api/v1/popups/{uuid.uuid4()}/approval-strategy",
            operator_token_tenant_a,
        )

    def test_operator_cannot_upsert_event_settings(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        assert_forbidden(
            client,
            "PUT",
            f"/api/v1/event-settings/{uuid.uuid4()}",
            operator_token_tenant_a,
            json={},
        )

    def test_operator_cannot_patch_base_field_config(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        assert_forbidden(
            client,
            "PATCH",
            f"/api/v1/base-field-configs/{uuid.uuid4()}",
            operator_token_tenant_a,
            json={"label": "x"},
        )

    def test_operator_cannot_create_human(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        """POST /humans is SUPERADMIN-only — OPERATOR must get 403."""
        assert_forbidden(
            client,
            "POST",
            "/api/v1/humans",
            operator_token_tenant_a,
            json={"email": f"test-{uuid.uuid4().hex[:6]}@test.com"},
        )


# ---------------------------------------------------------------------------
# ROLE_HIERARCHY — OPERATOR can only manage VIEWER and CHECK_IN_CONTROLLER
# ---------------------------------------------------------------------------


class TestOperatorRoleHierarchy:
    """OPERATOR cannot create/edit/delete users with role ADMIN, OPERATOR,
    or SUPERADMIN. Only roles strictly below OPERATOR (VIEWER, CHECK_IN_CONTROLLER)."""

    def test_operator_can_create_viewer(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        response = client.post(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {operator_token_tenant_a}"},
            json={
                "email": f"new-viewer-{uuid.uuid4().hex[:6]}@test.com",
                "role": "viewer",
            },
        )
        assert response.status_code == 201, (
            f"OPERATOR must be able to create VIEWER, got {response.status_code}: "
            f"{response.text}"
        )

    def test_operator_can_create_check_in_controller(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        response = client.post(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {operator_token_tenant_a}"},
            json={
                "email": f"new-controller-{uuid.uuid4().hex[:6]}@test.com",
                "role": "check_in_controller",
            },
        )
        assert response.status_code == 201, (
            f"OPERATOR must be able to create CHECK_IN_CONTROLLER, got "
            f"{response.status_code}: {response.text}"
        )

    def test_operator_cannot_create_admin(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        assert_forbidden(
            client,
            "POST",
            "/api/v1/users",
            operator_token_tenant_a,
            json={
                "email": f"new-admin-{uuid.uuid4().hex[:6]}@test.com",
                "role": "admin",
            },
        )

    def test_operator_cannot_create_operator_peer(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        assert_forbidden(
            client,
            "POST",
            "/api/v1/users",
            operator_token_tenant_a,
            json={
                "email": f"new-op-{uuid.uuid4().hex[:6]}@test.com",
                "role": "operator",
            },
        )

    def test_operator_cannot_create_superadmin(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        assert_forbidden(
            client,
            "POST",
            "/api/v1/users",
            operator_token_tenant_a,
            json={
                "email": f"new-sa-{uuid.uuid4().hex[:6]}@test.com",
                "role": "superadmin",
            },
        )

    def test_operator_cannot_delete_admin(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
        admin_user_tenant_a: Users,
    ) -> None:
        assert_forbidden(
            client,
            "DELETE",
            f"/api/v1/users/{admin_user_tenant_a.id}",
            operator_token_tenant_a,
        )

    def test_operator_cannot_patch_admin(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
        admin_user_tenant_a: Users,
    ) -> None:
        assert_forbidden(
            client,
            "PATCH",
            f"/api/v1/users/{admin_user_tenant_a.id}",
            operator_token_tenant_a,
            json={"full_name": "Mallory"},
        )

    def test_operator_cannot_delete_peer_operator(
        self,
        client: TestClient,
        db: Session,
        operator_token_tenant_a: str,
        operator_user_tenant_a: Users,
    ) -> None:
        # Create a second operator in the same tenant
        peer_email = f"peer-op-{uuid.uuid4().hex[:6]}@test.com"
        peer = Users(
            email=peer_email,
            role=UserRole.OPERATOR,
            tenant_id=operator_user_tenant_a.tenant_id,
        )
        db.add(peer)
        db.commit()
        db.refresh(peer)

        assert_forbidden(
            client,
            "DELETE",
            f"/api/v1/users/{peer.id}",
            operator_token_tenant_a,
        )

    def test_operator_list_users_excludes_admins_and_peers(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
        admin_user_tenant_a: Users,
        operator_user_tenant_a: Users,
    ) -> None:
        response = client.get(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {operator_token_tenant_a}"},
        )
        assert response.status_code == 200, response.text
        roles_seen = {u["role"] for u in response.json()["results"]}
        # Only viewer + check_in_controller should be returned
        assert roles_seen.issubset({"viewer", "check_in_controller"}), (
            f"OPERATOR list_users returned forbidden roles: {roles_seen}"
        )


# ---------------------------------------------------------------------------
# OPERATOR uses CRUD credentials (not READONLY) for tenant DB
# ---------------------------------------------------------------------------


class TestOperatorUsesCrudCredentials:
    """OPERATOR should have write access to the tenant DB (CRUD, not READONLY).
    A read-only credential would reject any INSERT.
    """

    def test_operator_can_create_via_tenant_session(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        """Create a coupon to force a write through TenantSession.

        If OPERATOR got READONLY credentials by mistake, this would fail
        with a 500/DB permission error rather than 201/400.
        """
        response = client.post(
            "/api/v1/coupons",
            headers={"Authorization": f"Bearer {operator_token_tenant_a}"},
            json={
                "code": f"OP-{uuid.uuid4().hex[:6].upper()}",
                "popup_id": str(uuid.uuid4()),  # any UUID; we just want past the gate
                "discount_value": 10,
                "discount_type": "percentage",
            },
        )
        # 422 (validation), 404 (popup not found), 400 (bad) — all acceptable.
        # 403 (forbidden) and 500 (permission denied via READONLY) are NOT acceptable.
        assert response.status_code != 403, (
            f"OPERATOR must not get 403 on POST /coupons: {response.text}"
        )
        assert response.status_code != 500, (
            f"OPERATOR must not get 500 (likely READONLY DB role) on POST /coupons: "
            f"{response.text}"
        )


# Suppress unused-import warning for create_access_token (used by other tests
# via fixtures defined in conftest.py — keeping import here documents the
# token-creation pattern in case operator fixtures get moved).
_ = create_access_token
_ = select
