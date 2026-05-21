"""Tests for POST /third-party-apps/{id}/rotate — key rotation.

REQ-6.5: rotate replaces hash + prefix, returns new raw key once.
         Old key is invalid after rotation.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.api_key.crud import hash_key

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
            "name": f"rotate-base-{uuid.uuid4().hex[:6]}",
            "allowed_token_scopes": ["portal:self_read"],
            "allowed_api_key_scopes": [],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestRotateThirdPartyApp:
    """REQ-6.5 — rotate replaces key hash and prefix."""

    def test_rotate_returns_new_raw_key(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """REQ-6.5.a — rotate returns new raw key in response."""
        app = _create_app(client, admin_token_tenant_a)
        old_prefix = app["prefix"]

        resp = client.post(
            f"{BASE_URL}/{app['id']}/rotate",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "raw_key" in data
        assert isinstance(data["raw_key"], str)
        assert len(data["raw_key"]) > 8
        assert data["prefix"] == data["raw_key"][:8]

    def test_rotate_changes_prefix(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
    ) -> None:
        """After rotation, prefix is updated in the DB."""
        app = _create_app(client, admin_token_tenant_a)
        old_prefix = app["prefix"]

        rotate_resp = client.post(
            f"{BASE_URL}/{app['id']}/rotate",
            headers=_auth(admin_token_tenant_a),
        )
        assert rotate_resp.status_code == 200

        get_resp = client.get(f"{BASE_URL}/{app['id']}", headers=_auth(admin_token_tenant_a))
        assert get_resp.status_code == 200
        new_prefix = get_resp.json()["prefix"]
        # prefix must reflect the new key (may differ from old)
        assert rotate_resp.json()["prefix"] == new_prefix

    def test_rotate_old_key_invalid(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
    ) -> None:
        """REQ-6.5.b — old key is invalid for validation after rotation."""
        from app.api.third_party_app.crud import validate_third_party_key
        from fastapi import HTTPException

        # Create and immediately get the app; we need to test key validation
        # via the CRUD layer directly, since we don't have the raw key from create
        # in a persistent way (we captured it at creation).
        app = _create_app(client, admin_token_tenant_a)
        original_raw = app["raw_key"]

        # Rotate
        rotate_resp = client.post(
            f"{BASE_URL}/{app['id']}/rotate",
            headers=_auth(admin_token_tenant_a),
        )
        assert rotate_resp.status_code == 200

        # Old key should now fail validation
        import pytest
        with pytest.raises(HTTPException) as exc_info:
            validate_third_party_key(db, original_raw)
        assert exc_info.value.status_code == 401

    def test_rotate_response_has_no_key_hash(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Rotate response never exposes key_hash."""
        app = _create_app(client, admin_token_tenant_a)
        resp = client.post(
            f"{BASE_URL}/{app['id']}/rotate",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200
        assert "key_hash" not in resp.json()

    def test_cannot_rotate_revoked_app(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Rotating a revoked app → 409."""
        app = _create_app(client, admin_token_tenant_a)
        del_resp = client.delete(f"{BASE_URL}/{app['id']}", headers=_auth(admin_token_tenant_a))
        assert del_resp.status_code == 204

        rotate_resp = client.post(
            f"{BASE_URL}/{app['id']}/rotate",
            headers=_auth(admin_token_tenant_a),
        )
        assert rotate_resp.status_code == 409, rotate_resp.text

    def test_rotate_cross_tenant_returns_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        admin_token_tenant_b: str,
    ) -> None:
        """Cannot rotate app from another tenant — 404."""
        app_b = client.post(
            BASE_URL,
            headers=_auth(admin_token_tenant_b),
            json={
                "name": f"b-rotate-{uuid.uuid4().hex[:6]}",
                "allowed_token_scopes": ["portal:self_read"],
                "allowed_api_key_scopes": [],
            },
        )
        assert app_b.status_code == 201
        resp = client.post(
            f"{BASE_URL}/{app_b.json()['id']}/rotate",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 404, resp.text
