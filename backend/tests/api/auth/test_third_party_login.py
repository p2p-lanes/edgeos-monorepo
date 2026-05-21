"""Third-party OTP login + authenticate endpoint contract tests.

RED-phase for Block 5. All tests should FAIL until:
  - ThirdPartyHumanLogin / ThirdPartyHumanVerify schemas are added.
  - login_existing_human / _send_human_code are added to auth/crud.py.
  - POST /auth/human/third-party/login and /auth/human/third-party/authenticate
    are wired up in auth/router.py.

REQ-TP-01 ... REQ-TP-07
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.human.models import Humans
from app.api.tenant.models import Tenants
from app.core.security import THIRD_PARTY_TOKEN_SCOPES_MAX, decode_access_token

LOGIN_URL = "/api/v1/auth/human/third-party/login"
AUTH_URL = "/api/v1/auth/human/third-party/authenticate"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_human(db: Session, *, tenant: Tenants, email: str) -> Humans:
    h = Humans(tenant_id=tenant.id, email=email)
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def _login_headers(api_key: str) -> dict[str, str]:
    return {"X-Third-Party-Api-Key": api_key}


# ---------------------------------------------------------------------------
# REQ-TP-01 — missing header returns 422 (FastAPI required-header validation)
# ---------------------------------------------------------------------------


class TestThirdPartyLoginHeaders:
    def test_missing_api_key_header_returns_422(
        self,
        client: TestClient,
    ) -> None:
        """X-Third-Party-Api-Key is required. Absent header → 422."""
        resp = client.post(
            LOGIN_URL,
            json={"email": "nobody@example.com"},
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# REQ-TP-02 — invalid / disabled key returns 401
# ---------------------------------------------------------------------------


class TestThirdPartyLoginKeyValidation:
    def test_wrong_api_key_returns_401(
        self,
        client: TestClient,
        third_party_enabled_tenant,
        db: Session,
    ) -> None:
        """A key that doesn't match any tenant's stored hash → 401."""
        tenant, _app, _raw = third_party_enabled_tenant
        email = f"key-mismatch-{uuid.uuid4().hex[:6]}@example.com"
        _make_human(db, tenant=tenant, email=email)

        resp = client.post(
            LOGIN_URL,
            headers=_login_headers("definitely_wrong_key"),
            json={"email": email},
        )
        assert resp.status_code == 401

    def test_unknown_key_returns_401(
        self,
        client: TestClient,
        tenant_b: Tenants,
    ) -> None:
        """An arbitrary key that no tenant has registered → 401 (collapses with the
        wrong-key branch — callers cannot distinguish disabled vs unknown).
        """
        # tenant_b has no third_party_apps rows; the key below doesn't
        # match any row either way.
        resp = client.post(
            LOGIN_URL,
            headers=_login_headers("any_key"),
            json={"email": "nobody@example.com"},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# REQ-TP-03 / REQ-TP-07 — existing-human-only; no auto-create
# ---------------------------------------------------------------------------


class TestThirdPartyLoginExistingHumanOnly:
    def test_unknown_email_returns_generic_error_and_does_not_create_human(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """Unknown email → generic error (401 or 404). No new human row created."""
        tenant, _app, raw_key = third_party_enabled_tenant
        email = f"tp-ghost-{uuid.uuid4().hex[:8]}@example.com"

        before_count = len(
            list(
                db.exec(
                    select(Humans).where(
                        Humans.tenant_id == tenant.id, Humans.email == email
                    )
                ).all()
            )
        )

        resp = client.post(
            LOGIN_URL,
            headers=_login_headers(raw_key),
            json={"email": email},
        )
        assert resp.status_code in {401, 404}

        after_count = len(
            list(
                db.exec(
                    select(Humans).where(
                        Humans.tenant_id == tenant.id, Humans.email == email
                    )
                ).all()
            )
        )
        assert after_count == before_count, "Must not create a new human row"


# ---------------------------------------------------------------------------
# REQ-TP-04 — valid key + existing human → OTP sent, 200
# ---------------------------------------------------------------------------


class TestThirdPartyLoginHappyPath:
    def test_existing_human_receives_otp(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """Valid key + existing human → mail sent, 200 response."""
        tenant, _app, raw_key = third_party_enabled_tenant
        email = f"tp-login-ok-{uuid.uuid4().hex[:8]}@example.com"
        _make_human(db, tenant=tenant, email=email)

        with pytest.MonkeyPatch.context() as mp:
            sent: list[str] = []

            async def _fake_send(*args, **kwargs) -> bool:  # noqa: ANN002
                sent.append(kwargs.get("to") or (args[0] if args else ""))
                return True

            mp.setattr(
                "app.services.email.EmailService.send_login_code_human",
                _fake_send,
            )

            resp = client.post(
                LOGIN_URL,
                headers=_login_headers(raw_key),
                json={"email": email},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "message" in data


# ---------------------------------------------------------------------------
# REQ-TP-05 — authenticate happy path → JWT with third_party scopes
# ---------------------------------------------------------------------------


class TestThirdPartyAuthenticate:
    def test_authenticate_mints_jwt_with_third_party_issued_via_and_scopes(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """Valid OTP verify → JWT where issued_via=third_party, scopes=THIRD_PARTY_TOKEN_SCOPES."""
        from unittest.mock import patch

        tenant, _app, raw_key = third_party_enabled_tenant
        email = f"tp-auth-ok-{uuid.uuid4().hex[:8]}@example.com"
        _make_human(db, tenant=tenant, email=email)

        captured_code: list[str] = []

        async def _fake_send(_self, **kwargs) -> bool:  # noqa: ANN001
            captured_code.append(kwargs["context"].auth_code)
            return True

        from app.services.email import EmailService

        with patch.object(EmailService, "send_login_code_human", _fake_send):
            login_resp = client.post(
                LOGIN_URL,
                headers=_login_headers(raw_key),
                json={"email": email},
            )
        assert login_resp.status_code == 200, login_resp.text
        assert captured_code, "Expected email to be sent with OTP code"

        code = captured_code[0]
        auth_resp = client.post(
            AUTH_URL,
            headers=_login_headers(raw_key),
            json={"email": email, "code": code},
        )
        assert auth_resp.status_code == 200, auth_resp.text
        token_data = auth_resp.json()
        assert "access_token" in token_data

        payload = decode_access_token(token_data["access_token"])
        assert payload.issued_via == "third_party"
        assert set(payload.scopes) == set(THIRD_PARTY_TOKEN_SCOPES_MAX)

    def test_wrong_code_returns_error(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """Correct key, correct email, wrong OTP → non-200."""
        from unittest.mock import patch

        from app.services.email import EmailService

        tenant, _app, raw_key = third_party_enabled_tenant
        email = f"tp-wrong-code-{uuid.uuid4().hex[:8]}@example.com"
        _make_human(db, tenant=tenant, email=email)

        async def _fake_send(_self, *_args, **_kwargs) -> bool:  # noqa: ANN001
            return True

        with patch.object(EmailService, "send_login_code_human", _fake_send):
            login_resp = client.post(
                LOGIN_URL,
                headers=_login_headers(raw_key),
                json={"email": email},
            )
        assert login_resp.status_code == 200

        auth_resp = client.post(
            AUTH_URL,
            headers=_login_headers(raw_key),
            json={"email": email, "code": "000000"},
        )
        assert auth_resp.status_code != 200

    def test_authenticate_wrong_api_key_returns_401(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """Authenticate with wrong key → 401 even if code would be valid."""
        tenant, _app, _raw = third_party_enabled_tenant
        email = f"tp-auth-badkey-{uuid.uuid4().hex[:8]}@example.com"
        _make_human(db, tenant=tenant, email=email)

        resp = client.post(
            AUTH_URL,
            headers=_login_headers("wrong_key"),
            json={"email": email, "code": "123456"},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# REQ-TP-05 — JWT issued by third-party can call self_read endpoint
# ---------------------------------------------------------------------------


class TestThirdPartyJwtAccess:
    def test_third_party_jwt_can_call_self_read_endpoint(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
        third_party_jwt_factory,
    ) -> None:
        """A JWT minted via third-party path can call GET /humans/me."""
        tenant, _app, _raw = third_party_enabled_tenant
        email = f"tp-me-{uuid.uuid4().hex[:8]}@example.com"
        human = _make_human(db, tenant=tenant, email=email)

        token = third_party_jwt_factory(human=human)
        resp = client.get(
            "/api/v1/humans/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Cross-flow OTP isolation — a code emitted by the third-party flow
# MUST NOT be redeemable via the portal /authenticate endpoint, and
# vice-versa.
# ---------------------------------------------------------------------------


class TestCrossFlowOtpIsolation:
    def test_third_party_code_cannot_authenticate_via_portal(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """An OTP emitted via third-party login must be rejected by the
        regular portal /auth/human/authenticate endpoint."""
        from unittest.mock import patch

        from app.services.email import EmailService

        tenant, _app, raw_key = third_party_enabled_tenant
        email = f"tp-isolate-{uuid.uuid4().hex[:8]}@example.com"
        _make_human(db, tenant=tenant, email=email)

        captured_code: list[str] = []

        async def _fake_send(_self, **kwargs) -> bool:  # noqa: ANN001
            captured_code.append(kwargs["context"].auth_code)
            return True

        with patch.object(EmailService, "send_login_code_human", _fake_send):
            login_resp = client.post(
                LOGIN_URL,
                headers=_login_headers(raw_key),
                json={"email": email},
            )
        assert login_resp.status_code == 200
        assert captured_code

        portal_resp = client.post(
            "/api/v1/auth/human/authenticate",
            json={
                "email": email,
                "tenant_id": str(tenant.id),
                "code": captured_code[0],
            },
        )
        assert portal_resp.status_code == 401, (
            "Third-party code must not be redeemable via portal authenticate"
        )
