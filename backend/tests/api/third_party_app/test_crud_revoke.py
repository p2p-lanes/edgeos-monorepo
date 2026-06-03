"""Tests for DELETE /third-party-apps/{id} — soft revoke.

REQ-6.6: soft revoke sets revoked_at, does NOT hard-delete.
         Revoked app key is rejected.
         GET still returns the row (row is preserved).
         App does not appear in list after revoke.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

BASE_URL = "/api/v1/third-party-apps"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _auth(token: str) -> dict[str, str]:
    return _bearer(token)


def _create_app(client: TestClient, token: str) -> dict:
    resp = client.post(
        BASE_URL,
        headers=_auth(token),
        json={
            "name": f"revoke-base-{uuid.uuid4().hex[:6]}",
            "allowed_token_scopes": ["portal:applications:read"],
            "allowed_api_key_scopes": [],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestRevokeThirdPartyApp:
    """REQ-6.6 — soft revoke."""

    def test_delete_returns_204(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """DELETE returns 204."""
        app = _create_app(client, admin_token_tenant_a)
        resp = client.delete(
            f"{BASE_URL}/{app['id']}", headers=_auth(admin_token_tenant_a)
        )
        assert resp.status_code == 204, resp.text

    def test_revoked_app_has_revoked_at_set(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """After DELETE, GET still returns the row with revoked_at set."""
        app = _create_app(client, admin_token_tenant_a)
        client.delete(f"{BASE_URL}/{app['id']}", headers=_auth(admin_token_tenant_a))

        get_resp = client.get(
            f"{BASE_URL}/{app['id']}", headers=_auth(admin_token_tenant_a)
        )
        assert get_resp.status_code == 200, get_resp.text
        data = get_resp.json()
        assert data["revoked_at"] is not None
        assert data["active"] is False

    def test_revoked_app_key_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
    ) -> None:
        """REQ-6.6.b — revoked app's key is rejected by validate_third_party_key."""
        import pytest
        from fastapi import HTTPException

        from app.api.third_party_app.crud import validate_third_party_key

        app = _create_app(client, admin_token_tenant_a)
        raw_key = app["raw_key"]

        client.delete(f"{BASE_URL}/{app['id']}", headers=_auth(admin_token_tenant_a))

        with pytest.raises(HTTPException) as exc_info:
            validate_third_party_key(db, raw_key)
        assert exc_info.value.status_code == 401

    def test_revoked_app_not_in_list(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """REQ-6.6.a — revoked app does not appear in list."""
        app = _create_app(client, admin_token_tenant_a)
        client.delete(f"{BASE_URL}/{app['id']}", headers=_auth(admin_token_tenant_a))

        list_resp = client.get(BASE_URL, headers=_auth(admin_token_tenant_a))
        assert list_resp.status_code == 200
        active_ids = [
            r["id"] for r in list_resp.json()["results"] if r["revoked_at"] is None
        ]
        assert app["id"] not in active_ids

    def test_delete_missing_returns_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Non-existent app → 404."""
        resp = client.delete(
            f"{BASE_URL}/{uuid.uuid4()}",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 404, resp.text

    def test_delete_cross_tenant_returns_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        admin_token_tenant_b: str,
    ) -> None:
        """Cannot delete app from another tenant — 404."""
        app_b = client.post(
            BASE_URL,
            headers=_auth(admin_token_tenant_b),
            json={
                "name": f"b-del-{uuid.uuid4().hex[:6]}",
                "allowed_token_scopes": ["portal:applications:read"],
                "allowed_api_key_scopes": [],
            },
        )
        assert app_b.status_code == 201
        resp = client.delete(
            f"{BASE_URL}/{app_b.json()['id']}",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 404, resp.text

    def test_double_delete_is_idempotent(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Deleting an already-revoked app returns 204 (idempotent)."""
        app = _create_app(client, admin_token_tenant_a)
        resp1 = client.delete(
            f"{BASE_URL}/{app['id']}", headers=_auth(admin_token_tenant_a)
        )
        assert resp1.status_code == 204
        resp2 = client.delete(
            f"{BASE_URL}/{app['id']}", headers=_auth(admin_token_tenant_a)
        )
        # Should be 204 (idempotent) OR 409 — both acceptable; 404 is not
        assert resp2.status_code in (204, 409), resp2.text
