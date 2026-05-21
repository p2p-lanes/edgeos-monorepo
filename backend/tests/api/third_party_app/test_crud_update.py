"""Tests for PATCH /third-party-apps/{id} — update flow.

REQ-6.3: scope subset validation on patch.
REQ-6.4: name uniqueness on rename.
Design: cannot patch a revoked app (409).
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.api.tenant.models import Tenants

BASE_URL = "/api/v1/third-party-apps"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _auth(token: str) -> dict[str, str]:
    return _bearer(token)


def _create_app(client: TestClient, token: str, name: str | None = None) -> dict:
    resp = client.post(
        BASE_URL,
        headers=_auth(token),
        json={
            "name": name or f"patch-base-{uuid.uuid4().hex[:6]}",
            "allowed_token_scopes": ["portal:self_read"],
            "allowed_api_key_scopes": ["events:read"],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestPatchThirdPartyApp:
    """PATCH flow."""

    def test_admin_can_rename_app(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Renaming to an unused name succeeds."""
        app = _create_app(client, admin_token_tenant_a)
        new_name = f"renamed-{uuid.uuid4().hex[:6]}"
        resp = client.patch(
            f"{BASE_URL}/{app['id']}",
            headers=_auth(admin_token_tenant_a),
            json={"name": new_name},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == new_name

    def test_admin_can_update_scopes(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Updating scopes to valid values succeeds."""
        app = _create_app(client, admin_token_tenant_a)
        resp = client.patch(
            f"{BASE_URL}/{app['id']}",
            headers=_auth(admin_token_tenant_a),
            json={"allowed_token_scopes": ["portal:self_read", "portal:directory_read"]},
        )
        assert resp.status_code == 200, resp.text
        assert set(resp.json()["allowed_token_scopes"]) == {
            "portal:self_read",
            "portal:directory_read",
        }

    def test_patch_invalid_token_scope_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """REQ-6.3.b — invalid scope in patch → 422."""
        app = _create_app(client, admin_token_tenant_a)
        resp = client.patch(
            f"{BASE_URL}/{app['id']}",
            headers=_auth(admin_token_tenant_a),
            json={"allowed_token_scopes": ["scope:not_valid"]},
        )
        assert resp.status_code == 422, resp.text

    def test_patch_invalid_api_key_scope_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Invalid api_key scope in patch → 422."""
        app = _create_app(client, admin_token_tenant_a)
        resp = client.patch(
            f"{BASE_URL}/{app['id']}",
            headers=_auth(admin_token_tenant_a),
            json={"allowed_api_key_scopes": ["admin:nope"]},
        )
        assert resp.status_code == 422, resp.text

    def test_patch_duplicate_name_returns_409(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """REQ-6.4 — renaming to existing active name → 409."""
        name_a = f"taken-{uuid.uuid4().hex[:6]}"
        name_b = f"other-{uuid.uuid4().hex[:6]}"
        _create_app(client, admin_token_tenant_a, name=name_a)
        app_b = _create_app(client, admin_token_tenant_a, name=name_b)

        resp = client.patch(
            f"{BASE_URL}/{app_b['id']}",
            headers=_auth(admin_token_tenant_a),
            json={"name": name_a},
        )
        assert resp.status_code == 409, resp.text

    def test_cannot_patch_revoked_app(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Patching a revoked app → 409."""
        app = _create_app(client, admin_token_tenant_a)
        del_resp = client.delete(f"{BASE_URL}/{app['id']}", headers=_auth(admin_token_tenant_a))
        assert del_resp.status_code == 204

        patch_resp = client.patch(
            f"{BASE_URL}/{app['id']}",
            headers=_auth(admin_token_tenant_a),
            json={"name": f"new-name-{uuid.uuid4().hex[:6]}"},
        )
        assert patch_resp.status_code == 409, patch_resp.text

    def test_patch_cross_tenant_returns_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        admin_token_tenant_b: str,
    ) -> None:
        """Cannot patch app from another tenant."""
        app_b = _create_app(client, admin_token_tenant_b)
        resp = client.patch(
            f"{BASE_URL}/{app_b['id']}",
            headers=_auth(admin_token_tenant_a),
            json={"name": "steal"},
        )
        assert resp.status_code == 404, resp.text

    def test_patch_missing_returns_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Non-existent app → 404."""
        resp = client.patch(
            f"{BASE_URL}/{uuid.uuid4()}",
            headers=_auth(admin_token_tenant_a),
            json={"name": "ghost"},
        )
        assert resp.status_code == 404, resp.text
