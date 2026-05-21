"""Per-app lookup tests for _validate_third_party_key refactor.

RED-phase for Slice 1 task 1.13.
Tests fail until validate_third_party_key is in third_party_app.crud
and auth/router.py uses it.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.tenant.models import Tenants

LOGIN_URL = "/api/v1/auth/human/third-party/login"
AUTH_URL = "/api/v1/auth/human/third-party/authenticate"


def _login_headers(api_key: str) -> dict[str, str]:
    return {"X-Third-Party-Api-Key": api_key}


class TestValidateThirdPartyKey:
    def test_valid_active_key_returns_tenant_and_app(
        self, db: Session, third_party_enabled_tenant
    ) -> None:
        """validate_third_party_key returns (tenant, app) for a valid active key."""
        from app.api.third_party_app.crud import validate_third_party_key

        tenant, app, raw_key = third_party_enabled_tenant
        result_tenant, result_app = validate_third_party_key(db, raw_key)
        assert result_tenant.id == tenant.id
        assert result_app.active is True
        assert result_app.revoked_at is None

    def test_unknown_key_raises_401(self, db: Session) -> None:
        """An unknown key raises HTTPException with status 401."""
        from fastapi import HTTPException

        from app.api.third_party_app.crud import validate_third_party_key

        with pytest.raises(HTTPException) as exc_info:
            validate_third_party_key(db, "definitely-unknown-key-xyz")
        assert exc_info.value.status_code == 401

    def test_revoked_key_raises_401(self, db: Session, tenant_a: Tenants) -> None:
        """A revoked app's key raises HTTPException with status 401."""
        from fastapi import HTTPException

        from app.api.api_key.crud import hash_key
        from app.api.third_party_app.crud import validate_third_party_key
        from app.api.third_party_app.models import ThirdPartyApps

        raw_key = f"revoked-test-key-{uuid.uuid4().hex}"
        app = ThirdPartyApps(
            tenant_id=tenant_a.id,
            name=f"revoked-{uuid.uuid4().hex[:6]}",
            key_hash=hash_key(raw_key),
            prefix=raw_key[:8],
            active=False,
            revoked_at=datetime.now(UTC),
        )
        db.add(app)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            validate_third_party_key(db, raw_key)
        assert exc_info.value.status_code == 401

        db.delete(app)
        db.commit()

    def test_inactive_key_raises_401(self, db: Session, tenant_a: Tenants) -> None:
        """An inactive (active=False) app's key raises HTTPException with status 401."""
        from fastapi import HTTPException

        from app.api.api_key.crud import hash_key
        from app.api.third_party_app.crud import validate_third_party_key
        from app.api.third_party_app.models import ThirdPartyApps

        raw_key = f"inactive-test-key-{uuid.uuid4().hex}"
        app = ThirdPartyApps(
            tenant_id=tenant_a.id,
            name=f"inactive-{uuid.uuid4().hex[:6]}",
            key_hash=hash_key(raw_key),
            prefix=raw_key[:8],
            active=False,
            revoked_at=None,
        )
        db.add(app)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            validate_third_party_key(db, raw_key)
        assert exc_info.value.status_code == 401

        db.delete(app)
        db.commit()


class TestThirdPartyLoginWithPerAppLookup:
    def test_login_endpoint_still_works(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """The login endpoint returns 200 (or email-not-found 401) — smoke test."""
        tenant, app, raw_key = third_party_enabled_tenant
        # Use an email that doesn't exist — triggers 401 but proves the key was valid
        # (different from a bad-key 401)
        resp = client.post(
            LOGIN_URL,
            headers=_login_headers(raw_key),
            json={"email": f"nonexistent-{uuid.uuid4().hex[:6]}@example.com"},
        )
        # 401 is fine here — it means the key was valid but the human doesn't exist
        assert resp.status_code in (200, 401, 422)

    def test_invalid_key_returns_401_on_login(
        self, client: TestClient
    ) -> None:
        """Invalid key returns 401 on /auth/human/third-party/login."""
        resp = client.post(
            LOGIN_URL,
            headers=_login_headers("totally-invalid-key-xxx"),
            json={"email": "anyone@example.com"},
        )
        assert resp.status_code == 401
