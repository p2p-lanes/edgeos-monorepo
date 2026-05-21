"""Tests for GET /me/access — happy paths and auth gate.

REQ-8.1: Only third-party JWTs (v2 + legacy) are accepted.
REQ-8.2: v2 JWT response matches app row.
REQ-8.3: legacy JWT response uses "legacy" as app_name.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.tenant.models import Tenants
from app.api.third_party_app.models import ThirdPartyApps
from app.core.security import create_access_token

BASE_URL = "/api/v1/me/access"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_human(db: Session, tenant: Tenants) -> Humans:
    h = Humans(tenant_id=tenant.id, email=f"ma-{uuid.uuid4().hex[:8]}@test.com")
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


@pytest.fixture(scope="module")
def access_app(db: Session, tenant_a: Tenants) -> tuple[ThirdPartyApps, str]:
    """Third-party app for /me/access tests."""
    from app.api.third_party_app import crud

    return crud.create(
        db,
        tenant_id=tenant_a.id,
        name=f"access-test-{uuid.uuid4().hex[:6]}",
        allowed_token_scopes=["portal:self_read"],
        allowed_api_key_scopes=["events:read"],
    )


class TestMeAccessAuth:
    """REQ-8.1 — Only third-party JWTs accepted."""

    def test_portal_jwt_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Regular portal JWT (issued_via=portal) gets 401."""
        h = _make_human(db, tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="portal",
        )
        resp = client.get(BASE_URL, headers=_bearer(token))
        assert resp.status_code == 401, resp.text

    def test_admin_jwt_rejected(
        self, client: TestClient, admin_token_tenant_a: str
    ) -> None:
        """Admin JWT (token_type=user) gets 401."""
        resp = client.get(BASE_URL, headers=_bearer(admin_token_tenant_a))
        assert resp.status_code == 401, resp.text

    def test_unauthenticated_rejected(self, client: TestClient) -> None:
        """No auth header gets 401."""
        resp = client.get(BASE_URL)
        assert resp.status_code == 401, resp.text

    def test_v2_third_party_jwt_accepted(
        self,
        client: TestClient,
        db: Session,
        access_app: tuple[ThirdPartyApps, str],
        tenant_a: Tenants,
    ) -> None:
        """v2 JWT with issued_by_app_id gets 200."""
        app, _ = access_app
        h = _make_human(db, tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            issued_by_app_id=app.id,
        )
        resp = client.get(BASE_URL, headers=_bearer(token))
        assert resp.status_code == 200, resp.text

    def test_legacy_v1_third_party_jwt_accepted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Legacy JWT (issued_via=third_party, no issued_by_app_id) gets 200."""
        h = _make_human(db, tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:self_read"],
        )
        resp = client.get(BASE_URL, headers=_bearer(token))
        assert resp.status_code == 200, resp.text


class TestMeAccessResponseShape:
    """REQ-8.2 — v2 JWT returns app row data. REQ-8.3 — legacy uses 'legacy'."""

    def test_v2_response_matches_app_row(
        self,
        client: TestClient,
        db: Session,
        access_app: tuple[ThirdPartyApps, str],
        tenant_a: Tenants,
    ) -> None:
        """REQ-8.2.a — app_name, scopes, api_key_scopes match the app row."""
        app, _ = access_app
        h = _make_human(db, tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            issued_by_app_id=app.id,
        )
        resp = client.get(BASE_URL, headers=_bearer(token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["app_name"] == app.name
        assert set(data["scopes"]) == set(app.allowed_token_scopes)
        assert set(data["api_key_scopes"]) == set(app.allowed_api_key_scopes)

    def test_legacy_response_uses_legacy_app_name(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """REQ-8.3.a — legacy JWT returns app_name='legacy' and embedded scopes."""
        h = _make_human(db, tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:self_read", "portal:directory_read"],
        )
        resp = client.get(BASE_URL, headers=_bearer(token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["app_name"] == "legacy"
        assert set(data["scopes"]) == {"portal:self_read", "portal:directory_read"}

    def test_revoked_app_returns_401(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """App deleted between JWT mint and call returns 401."""
        from app.api.third_party_app import crud

        app, _ = crud.create(
            db,
            tenant_id=tenant_a.id,
            name=f"revoke-me-{uuid.uuid4().hex[:6]}",
            allowed_token_scopes=["portal:self_read"],
            allowed_api_key_scopes=[],
        )
        h = _make_human(db, tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            issued_by_app_id=app.id,
        )

        # Revoke the app
        crud.soft_revoke(db, app)

        resp = client.get(BASE_URL, headers=_bearer(token))
        assert resp.status_code == 401, resp.text


class TestMeAccessApiKeyDiscovery:
    """Pre-login discovery: agent has only the raw third-party api key and
    needs to learn what scopes the app exposes before triggering OTP login."""

    def test_api_key_only_returns_app_scopes(
        self,
        client: TestClient,
        access_app: tuple[ThirdPartyApps, str],
    ) -> None:
        """X-Third-Party-Api-Key alone (no JWT) returns the app's scope set."""
        app, raw_key = access_app
        resp = client.get(
            BASE_URL,
            headers={"X-Third-Party-Api-Key": raw_key},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["app_name"] == app.name
        assert set(body["scopes"]) == set(app.allowed_token_scopes)
        assert set(body["api_key_scopes"]) == set(app.allowed_api_key_scopes)

    def test_unknown_api_key_returns_401(self, client: TestClient) -> None:
        """An api key that doesn't match any app row returns 401."""
        resp = client.get(
            BASE_URL,
            headers={"X-Third-Party-Api-Key": "definitely-not-a-real-key"},
        )
        assert resp.status_code == 401, resp.text
