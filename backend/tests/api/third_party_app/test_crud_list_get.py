"""Tests for GET /third-party-apps and GET /third-party-apps/{id}.

REQ-6.2: list is tenant-scoped.
REQ-6.1.b: GET does not return raw_key.
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


def _create_app(
    client: TestClient,
    token: str,
    name: str | None = None,
    tenant_id: uuid.UUID | None = None,
) -> dict:
    headers = _auth(token)
    if tenant_id:
        headers.update(_tenant_header(tenant_id))
    payload = {
        "name": name or f"app-{uuid.uuid4().hex[:6]}",
        "allowed_token_scopes": ["portal:applications:read"],
        "allowed_api_key_scopes": [],
    }
    resp = client.post(BASE_URL, headers=headers, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestListThirdPartyApps:
    """REQ-6.2 — list is tenant-scoped."""

    def test_admin_sees_own_tenant_apps(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        admin_token_tenant_b: str,
        tenant_b: Tenants,
        superadmin_token: str,
    ) -> None:
        """REQ-6.2.a — ADMIN sees only own tenant's apps."""
        # Create one in tenant B (via superadmin)
        app_b = _create_app(
            client, superadmin_token, name=f"tenant-b-only-{uuid.uuid4().hex[:6]}", tenant_id=tenant_b.id
        )
        # Create one in tenant A
        app_a = _create_app(client, admin_token_tenant_a, name=f"tenant-a-{uuid.uuid4().hex[:6]}")

        resp = client.get(BASE_URL, headers=_auth(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        ids = [r["id"] for r in data["results"]]
        assert app_a["id"] in ids
        assert app_b["id"] not in ids

    def test_superadmin_scoped_to_tenant_b_sees_only_b(
        self,
        client: TestClient,
        superadmin_token: str,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        """REQ-6.2.b — SUPERADMIN scoped to tenant B sees only B's apps."""
        app_a = _create_app(client, admin_token_tenant_a, name=f"a-only-{uuid.uuid4().hex[:6]}")
        app_b = _create_app(
            client, superadmin_token, name=f"b-only-{uuid.uuid4().hex[:6]}", tenant_id=tenant_b.id
        )

        resp = client.get(BASE_URL, headers=_auth_tenant(superadmin_token, tenant_b.id))
        assert resp.status_code == 200, resp.text
        ids = [r["id"] for r in resp.json()["results"]]
        assert app_b["id"] in ids
        assert app_a["id"] not in ids

    def test_list_response_shape(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """List response has results + paging envelope."""
        resp = client.get(BASE_URL, headers=_auth(admin_token_tenant_a))
        assert resp.status_code == 200
        data = resp.json()
        assert "results" in data
        assert "paging" in data
        assert isinstance(data["results"], list)

    def test_list_items_do_not_include_raw_key(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """List items never expose key_hash or raw_key."""
        _create_app(client, admin_token_tenant_a)
        resp = client.get(BASE_URL, headers=_auth(admin_token_tenant_a))
        assert resp.status_code == 200
        for item in resp.json()["results"]:
            assert "raw_key" not in item
            assert "key_hash" not in item
            assert "prefix" in item


class TestGetThirdPartyApp:
    """REQ-6.1.b + 404 on cross-tenant."""

    def test_admin_can_get_own_tenant_app(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN can retrieve an app that belongs to their tenant."""
        app = _create_app(client, admin_token_tenant_a)
        resp = client.get(f"{BASE_URL}/{app['id']}", headers=_auth(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["id"] == app["id"]

    def test_cross_tenant_returns_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        superadmin_token: str,
        tenant_b: Tenants,
    ) -> None:
        """ADMIN cannot see an app from another tenant — 404 (no info leak)."""
        app_b = _create_app(
            client, superadmin_token, name=f"b-secret-{uuid.uuid4().hex[:6]}", tenant_id=tenant_b.id
        )
        resp = client.get(f"{BASE_URL}/{app_b['id']}", headers=_auth(admin_token_tenant_a))
        assert resp.status_code == 404, resp.text

    def test_missing_id_returns_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Non-existent app → 404."""
        resp = client.get(
            f"{BASE_URL}/{uuid.uuid4()}",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 404, resp.text

    def test_get_public_fields_shape(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """GET returns all ThirdPartyAppPublic fields."""
        app = _create_app(client, admin_token_tenant_a)
        resp = client.get(f"{BASE_URL}/{app['id']}", headers=_auth(admin_token_tenant_a))
        assert resp.status_code == 200
        data = resp.json()
        for field in ("id", "tenant_id", "name", "prefix", "allowed_token_scopes",
                      "allowed_api_key_scopes", "active", "last_used_at",
                      "revoked_at", "created_at", "updated_at"):
            assert field in data, f"Missing field: {field}"
        assert "key_hash" not in data
        assert "raw_key" not in data
