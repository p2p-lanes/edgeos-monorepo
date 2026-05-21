"""Tests for POST /third-party-apps — create flow.

REQ-6.1: raw key returned once at creation, not on subsequent reads.
REQ-6.3: scope subset validation.
REQ-6.4: unique active name per tenant.
REQ-6.2: ADMIN tenant scope isolation, SUPERADMIN cross-tenant.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.api.tenant.models import Tenants

BASE_URL = "/api/v1/third-party-apps"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _tenant_header(tenant_id: uuid.UUID) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant_id)}


def _auth(token: str) -> dict[str, str]:
    return _bearer(token)


def _auth_tenant(token: str, tenant_id: uuid.UUID) -> dict[str, str]:
    return {**_bearer(token), **_tenant_header(tenant_id)}


_VALID_CREATE = {
    "name": "test-app",
    "allowed_token_scopes": ["portal:self_read"],
    "allowed_api_key_scopes": ["events:read"],
}


class TestCreateThirdPartyApp:
    """REQ-6.1.a — POST returns 201 with raw_key."""

    def test_admin_can_create_app(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN can create an app. Response includes raw_key (shown once)."""
        resp = client.post(
            BASE_URL,
            headers=_auth(admin_token_tenant_a),
            json={
                "name": f"create-test-{uuid.uuid4().hex[:6]}",
                "allowed_token_scopes": ["portal:self_read"],
                "allowed_api_key_scopes": ["events:read"],
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert "raw_key" in data
        assert isinstance(data["raw_key"], str)
        assert len(data["raw_key"]) > 8
        assert "id" in data
        assert "prefix" in data
        assert data["prefix"] == data["raw_key"][:8]
        assert "key_hash" not in data

    def test_created_app_has_correct_fields(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """Created app has tenant_id, name, scopes."""
        name = f"fields-test-{uuid.uuid4().hex[:6]}"
        resp = client.post(
            BASE_URL,
            headers=_auth(admin_token_tenant_a),
            json={
                "name": name,
                "allowed_token_scopes": ["portal:self_read"],
                "allowed_api_key_scopes": ["events:read"],
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["name"] == name
        assert data["tenant_id"] == str(tenant_a.id)
        assert data["allowed_token_scopes"] == ["portal:self_read"]
        assert data["allowed_api_key_scopes"] == ["events:read"]
        assert data["active"] is True
        assert data["revoked_at"] is None

    def test_get_does_not_return_raw_key(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """REQ-6.1.b — GET does not include raw_key, only prefix."""
        name = f"no-key-get-{uuid.uuid4().hex[:6]}"
        create_resp = client.post(
            BASE_URL,
            headers=_auth(admin_token_tenant_a),
            json={
                "name": name,
                "allowed_token_scopes": ["portal:self_read"],
                "allowed_api_key_scopes": [],
            },
        )
        assert create_resp.status_code == 201
        app_id = create_resp.json()["id"]

        get_resp = client.get(
            f"{BASE_URL}/{app_id}",
            headers=_auth(admin_token_tenant_a),
        )
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert "raw_key" not in data
        assert "key_hash" not in data
        assert "prefix" in data


class TestCreateScopeValidation:
    """REQ-6.3 — scope subset validation at create."""

    def test_invalid_token_scope_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Token scope not in MAX → 422."""
        resp = client.post(
            BASE_URL,
            headers=_auth(admin_token_tenant_a),
            json={
                "name": f"bad-scope-{uuid.uuid4().hex[:6]}",
                "allowed_token_scopes": ["scope:does_not_exist"],
                "allowed_api_key_scopes": [],
            },
        )
        assert resp.status_code == 422, resp.text

    def test_invalid_api_key_scope_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """API key scope not in MAX → 422."""
        resp = client.post(
            BASE_URL,
            headers=_auth(admin_token_tenant_a),
            json={
                "name": f"bad-ak-scope-{uuid.uuid4().hex[:6]}",
                "allowed_token_scopes": ["portal:self_read"],
                "allowed_api_key_scopes": ["admin:everything"],
            },
        )
        assert resp.status_code == 422, resp.text

    def test_empty_name_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Empty name → 422."""
        resp = client.post(
            BASE_URL,
            headers=_auth(admin_token_tenant_a),
            json={
                "name": "",
                "allowed_token_scopes": ["portal:self_read"],
                "allowed_api_key_scopes": [],
            },
        )
        assert resp.status_code == 422, resp.text


class TestCreateNameUniqueness:
    """REQ-6.4 — unique active name per tenant."""

    def test_duplicate_active_name_returns_409(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """REQ-6.4.a — two active apps with same (case-insensitive) name → 409."""
        name = f"dup-name-{uuid.uuid4().hex[:6]}"
        first = client.post(
            BASE_URL,
            headers=_auth(admin_token_tenant_a),
            json={
                "name": name,
                "allowed_token_scopes": ["portal:self_read"],
                "allowed_api_key_scopes": [],
            },
        )
        assert first.status_code == 201, first.text

        second = client.post(
            BASE_URL,
            headers=_auth(admin_token_tenant_a),
            json={
                "name": name.upper(),
                "allowed_token_scopes": ["portal:self_read"],
                "allowed_api_key_scopes": [],
            },
        )
        assert second.status_code == 409, second.text
        assert "name" in second.json()["detail"].lower() or "already" in second.json()["detail"].lower()

    def test_revoked_name_can_be_reused(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """REQ-6.4.b — revoked app name can be reused."""
        name = f"revoke-reuse-{uuid.uuid4().hex[:6]}"
        create_resp = client.post(
            BASE_URL,
            headers=_auth(admin_token_tenant_a),
            json={
                "name": name,
                "allowed_token_scopes": ["portal:self_read"],
                "allowed_api_key_scopes": [],
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        app_id = create_resp.json()["id"]

        del_resp = client.delete(f"{BASE_URL}/{app_id}", headers=_auth(admin_token_tenant_a))
        assert del_resp.status_code == 204

        reuse_resp = client.post(
            BASE_URL,
            headers=_auth(admin_token_tenant_a),
            json={
                "name": name,
                "allowed_token_scopes": ["portal:self_read"],
                "allowed_api_key_scopes": [],
            },
        )
        assert reuse_resp.status_code == 201, reuse_resp.text


class TestCreateSuperadmin:
    """REQ-6.2.b — SUPERADMIN creates cross-tenant when X-Tenant-Id is set."""

    def test_superadmin_can_create_with_tenant_header(
        self,
        client: TestClient,
        superadmin_token: str,
        tenant_b: Tenants,
    ) -> None:
        """SUPERADMIN with X-Tenant-Id creates app in that tenant."""
        resp = client.post(
            BASE_URL,
            headers=_auth_tenant(superadmin_token, tenant_b.id),
            json={
                "name": f"sa-create-{uuid.uuid4().hex[:6]}",
                "allowed_token_scopes": ["portal:self_read"],
                "allowed_api_key_scopes": [],
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["tenant_id"] == str(tenant_b.id)

    def test_unauthenticated_returns_401(self, client: TestClient) -> None:
        """No auth → 401."""
        resp = client.post(
            BASE_URL,
            json=_VALID_CREATE,
        )
        assert resp.status_code == 401, resp.text

    def test_viewer_returns_403(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER → 403."""
        resp = client.post(
            BASE_URL,
            headers=_auth(viewer_token_tenant_a),
            json=_VALID_CREATE,
        )
        assert resp.status_code == 403, resp.text
