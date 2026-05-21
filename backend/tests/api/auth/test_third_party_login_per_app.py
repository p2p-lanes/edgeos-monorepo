"""Per-app JWT scopes at third-party authenticate endpoint.

RED-phase for Slice 2 Block B.

REQ-3.1: JWT carries per-app token scopes and app identity.
REQ-3.2: Token scopes validated as subset of MAX at issuance.
REQ-5.1: last_used_at bumps on authenticate, NOT on login.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.tenant.models import Tenants
from app.services.email import EmailService

LOGIN_URL = "/api/v1/auth/human/third-party/login"
AUTH_URL = "/api/v1/auth/human/third-party/authenticate"


def _make_human(db: Session, *, tenant: Tenants, email: str) -> Humans:
    h = Humans(tenant_id=tenant.id, email=email)
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def _login_headers(api_key: str) -> dict[str, str]:
    return {"X-Third-Party-Api-Key": api_key}


def _do_login_and_capture_code(
    client: TestClient,
    raw_key: str,
    email: str,
) -> str:
    """Fire the login endpoint and return the captured OTP code."""
    captured: list[str] = []

    async def _fake_send(_self, **kwargs):  # noqa: ANN001
        captured.append(kwargs["context"].auth_code)
        return True

    with patch.object(EmailService, "send_login_code_human", _fake_send):
        resp = client.post(
            LOGIN_URL,
            headers=_login_headers(raw_key),
            json={"email": email},
        )
    assert resp.status_code == 200, resp.text
    assert captured, "Expected OTP code to be captured via email mock"
    return captured[0]


class TestJwtCarriesPerAppScopes:
    """REQ-3.1 — JWT scopes match app.allowed_token_scopes and carries app id."""

    def test_authenticate_mints_jwt_with_per_app_scopes(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """JWT scopes == app.allowed_token_scopes (not the global MAX)."""
        from app.core.security import decode_access_token

        tenant, app, raw_key = third_party_enabled_tenant
        email = f"pa-scopes-{uuid.uuid4().hex[:8]}@example.com"
        _make_human(db, tenant=tenant, email=email)

        code = _do_login_and_capture_code(client, raw_key, email)
        resp = client.post(
            AUTH_URL,
            headers=_login_headers(raw_key),
            json={"email": email, "code": code},
        )
        assert resp.status_code == 200, resp.text
        payload = decode_access_token(resp.json()["access_token"])
        assert set(payload.scopes) == set(app.allowed_token_scopes)

    def test_authenticate_mints_jwt_with_issued_by_app_id(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """JWT carries issued_by_app_id == app.id."""
        from app.core.security import decode_access_token

        tenant, app, raw_key = third_party_enabled_tenant
        email = f"pa-appid-{uuid.uuid4().hex[:8]}@example.com"
        _make_human(db, tenant=tenant, email=email)

        code = _do_login_and_capture_code(client, raw_key, email)
        resp = client.post(
            AUTH_URL,
            headers=_login_headers(raw_key),
            json={"email": email, "code": code},
        )
        assert resp.status_code == 200, resp.text
        payload = decode_access_token(resp.json()["access_token"])
        assert payload.issued_by_app_id == app.id

    def test_restricted_app_produces_restricted_scopes(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """An app with a single allowed_token_scope produces a JWT with only that scope."""
        from app.api.api_key.crud import generate_raw_key, hash_key
        from app.api.third_party_app.models import ThirdPartyApps
        from app.core.security import decode_access_token

        raw_key = generate_raw_key()
        restricted_app = ThirdPartyApps(
            tenant_id=tenant_a.id,
            name=f"restricted-{uuid.uuid4().hex[:6]}",
            key_hash=hash_key(raw_key),
            prefix=raw_key[:8],
            allowed_token_scopes=["portal:self_read"],
            allowed_api_key_scopes=[],
            active=True,
        )
        db.add(restricted_app)
        db.commit()
        db.refresh(restricted_app)

        email = f"pa-restricted-{uuid.uuid4().hex[:8]}@example.com"
        human = _make_human(db, tenant=tenant_a, email=email)

        code = _do_login_and_capture_code(client, raw_key, email)
        resp = client.post(
            AUTH_URL,
            headers=_login_headers(raw_key),
            json={"email": email, "code": code},
        )
        assert resp.status_code == 200, resp.text
        payload = decode_access_token(resp.json()["access_token"])
        assert list(payload.scopes) == ["portal:self_read"]
        assert payload.issued_by_app_id == restricted_app.id

        # Cleanup
        db.delete(restricted_app)
        db.commit()


class TestLastUsedAtBehavior:
    """REQ-5.1 — last_used_at bumps on authenticate, NOT on login."""

    def test_last_used_at_not_bumped_on_login(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """login endpoint must NOT change last_used_at."""
        tenant, app, raw_key = third_party_enabled_tenant
        db.refresh(app)
        last_used_before = app.last_used_at

        email = f"pa-login-notouch-{uuid.uuid4().hex[:8]}@example.com"
        _make_human(db, tenant=tenant, email=email)

        async def _fake_send(_self, **kwargs):  # noqa: ANN001
            return True

        with patch.object(EmailService, "send_login_code_human", _fake_send):
            resp = client.post(
                LOGIN_URL,
                headers=_login_headers(raw_key),
                json={"email": email},
            )
        assert resp.status_code == 200, resp.text

        db.refresh(app)
        # last_used_at must not have moved
        assert app.last_used_at == last_used_before

    def test_last_used_at_bumped_on_authenticate(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """authenticate endpoint MUST update last_used_at."""
        tenant, app, raw_key = third_party_enabled_tenant
        db.refresh(app)
        before = datetime.now(UTC)

        email = f"pa-auth-touch-{uuid.uuid4().hex[:8]}@example.com"
        _make_human(db, tenant=tenant, email=email)

        code = _do_login_and_capture_code(client, raw_key, email)
        resp = client.post(
            AUTH_URL,
            headers=_login_headers(raw_key),
            json={"email": email, "code": code},
        )
        assert resp.status_code == 200, resp.text

        db.refresh(app)
        assert app.last_used_at is not None
        assert app.last_used_at.replace(tzinfo=UTC) >= before


class TestOutOfMaxScopeIssuance:
    """REQ-3.2 — out-of-MAX scope in app row → 500 at issuance."""

    def test_app_with_invalid_token_scope_raises_500(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """An app whose allowed_token_scopes has a scope not in MAX
        must produce a 500 before minting any token."""
        from app.api.api_key.crud import generate_raw_key, hash_key
        from app.api.third_party_app.models import ThirdPartyApps

        raw_key = generate_raw_key()
        # Directly bypass schema validation to insert an invalid scope
        bad_app = ThirdPartyApps(
            tenant_id=tenant_a.id,
            name=f"bad-scope-{uuid.uuid4().hex[:6]}",
            key_hash=hash_key(raw_key),
            prefix=raw_key[:8],
            allowed_token_scopes=["scope:not_in_max"],  # invalid
            allowed_api_key_scopes=[],
            active=True,
        )
        db.add(bad_app)
        db.commit()
        db.refresh(bad_app)

        email = f"pa-badscope-{uuid.uuid4().hex[:8]}@example.com"
        _make_human(db, tenant=tenant_a, email=email)

        code = _do_login_and_capture_code(client, raw_key, email)
        resp = client.post(
            AUTH_URL,
            headers=_login_headers(raw_key),
            json={"email": email, "code": code},
        )
        # Must be 500 before returning any token
        assert resp.status_code == 500, resp.text

        # Cleanup
        db.delete(bad_app)
        db.commit()
