"""Self-serve trial signup + provisioning endpoint tests.

POST /trials         — pending trial + OTP email (rate-limited, public)
POST /trials/verify  — OTP verification + atomic provisioning

Tests force the DB fallback for pending storage (is_redis_available -> False)
so the OTP and pending data are deterministic regardless of a developer's
local Redis, and disable the per-IP rate limit (fail-open) except in the
dedicated rate-limit test. The OTP is captured from the mocked email send.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.attendee_category.models import AttendeeCategories
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.trial.models import PendingTrials
from app.api.user.models import Users
from app.core.security import decode_access_token
from app.services.email.service import EmailService
from app.utils.utils import slugify

TRIALS_URL = "/api/v1/trials"
VERIFY_URL = "/api/v1/trials/verify"


@contextmanager
def _trial_test_env():
    """Force DB-fallback pending storage + fail-open rate limiting, and
    capture every OTP email context sent through send_login_code_user."""
    sent: list[dict] = []

    async def _fake_send_email(*_args, **kwargs) -> bool:
        sent.append(
            {
                "to": kwargs["to"],
                "subject": kwargs["subject"],
                "context": kwargs["context"],
            }
        )
        return True

    with (
        patch("app.api.trial.crud.is_redis_available", return_value=False),
        patch("app.core.rate_limit.get_redis", return_value=None),
        patch.object(EmailService, "send_login_code_user", _fake_send_email),
        patch.object(EmailService, "send_trial_welcome", _fake_send_email),
    ):
        yield sent


def _unique_email() -> str:
    return f"trial-{uuid.uuid4().hex[:10]}@example.com"


def _start_trial(client: TestClient, gathering_name: str, email: str):
    return client.post(
        TRIALS_URL,
        json={"gathering_name": gathering_name, "email": email},
    )


def _get_code(db: Session, email: str) -> str:
    db.expire_all()
    row = db.exec(select(PendingTrials).where(PendingTrials.email == email)).first()
    assert row is not None, f"no pending trial row for {email}"
    return row.auth_code


# ---------------------------------------------------------------------------
# Happy path — end to end
# ---------------------------------------------------------------------------


def test_create_and_verify_provisions_trial(client: TestClient, db: Session) -> None:
    email = _unique_email()
    name = f"Solstice Gathering {uuid.uuid4().hex[:6]}"

    with _trial_test_env() as sent:
        resp = _start_trial(client, name, email)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["email"] == email
        assert body["expires_in_minutes"] == 15

        # OTP email went out through the passwordless engine
        assert len(sent) == 1
        assert sent[0]["to"] == email
        code = sent[0]["context"].auth_code
        assert code == _get_code(db, email)

        resp = client.post(VERIFY_URL, json={"email": email, "code": code})
        assert resp.status_code == 201, resp.text
        body = resp.json()

        # Welcome email with the onboarding checklist was sent
        welcome = [s for s in sent[1:] if s["to"] == email]
        assert len(welcome) == 1

    db.expire_all()

    # Tenant: trial-flagged, 7-day expiry, slug from the gathering name
    tenant = db.get(Tenants, uuid.UUID(body["tenant_id"]))
    assert tenant is not None
    assert tenant.name == name
    assert tenant.slug == slugify(name)
    assert tenant.is_trial is True
    assert tenant.suspended_at is None
    expires = tenant.trial_expires_at
    assert expires is not None
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    delta = expires - datetime.now(UTC)
    assert timedelta(days=6, hours=23) < delta < timedelta(days=7, hours=1)

    # First user: ADMIN of the new tenant, matching the verified email
    user = db.exec(
        select(Users).where(Users.email == email, Users.tenant_id == tenant.id)
    ).first()
    assert user is not None
    assert user.role == UserRole.ADMIN

    # Popup: draft, named after the gathering, main category seeded
    popup = db.get(Popups, uuid.UUID(body["popup_id"]))
    assert popup is not None
    assert popup.tenant_id == tenant.id
    assert popup.name == name
    assert popup.status == PopupStatus.draft
    assert popup.open_checkout_signing_secret is not None
    main_cat = db.exec(
        select(AttendeeCategories).where(AttendeeCategories.popup_id == popup.id)
    ).first()
    assert main_cat is not None

    # JWT: same shape as /auth/user/authenticate
    assert body["token_type"] == "bearer"
    payload = decode_access_token(body["access_token"])
    assert payload.token_type == "user"
    assert payload.sub == str(user.id)
    assert body["backoffice_url"]

    # Pending record was consumed
    db.expire_all()
    assert (
        db.exec(select(PendingTrials).where(PendingTrials.email == email)).first()
        is None
    )


# ---------------------------------------------------------------------------
# Slug collision — disambiguated with -2, -3, ...
# ---------------------------------------------------------------------------


def test_slug_collision_gets_numeric_suffix(client: TestClient, db: Session) -> None:
    name = f"Collision Fest {uuid.uuid4().hex[:6]}"
    taken = Tenants(name=name, slug=slugify(name))
    db.add(taken)
    db.commit()

    email = _unique_email()
    with _trial_test_env():
        assert _start_trial(client, name, email).status_code == 200
        code = _get_code(db, email)
        resp = client.post(VERIFY_URL, json={"email": email, "code": code})
        assert resp.status_code == 201, resp.text

    db.expire_all()
    tenant = db.get(Tenants, uuid.UUID(resp.json()["tenant_id"]))
    assert tenant.slug == f"{slugify(name)}-2"


# ---------------------------------------------------------------------------
# One active trial per email
# ---------------------------------------------------------------------------


def test_second_trial_for_same_email_is_rejected(
    client: TestClient, db: Session
) -> None:
    email = _unique_email()
    with _trial_test_env():
        assert _start_trial(client, "First Gathering", email).status_code == 200
        code = _get_code(db, email)
        assert (
            client.post(VERIFY_URL, json={"email": email, "code": code}).status_code
            == 201
        )

        resp = _start_trial(client, "Second Gathering", email)
        assert resp.status_code == 409


def test_pending_trial_blocks_second_request(client: TestClient) -> None:
    email = _unique_email()
    with _trial_test_env():
        assert _start_trial(client, "Pending Gathering", email).status_code == 200
        resp = _start_trial(client, "Pending Gathering Again", email)
        assert resp.status_code == 409


def test_suspended_trial_frees_the_email(client: TestClient, db: Session) -> None:
    """A suspended (expired) trial does not block a new signup."""
    email = _unique_email()
    with _trial_test_env():
        assert _start_trial(client, "Expired Gathering", email).status_code == 200
        code = _get_code(db, email)
        resp = client.post(VERIFY_URL, json={"email": email, "code": code})
        assert resp.status_code == 201

        db.expire_all()
        tenant = db.get(Tenants, uuid.UUID(resp.json()["tenant_id"]))
        tenant.suspended_at = datetime.now(UTC)
        db.add(tenant)
        db.commit()

        resp = _start_trial(client, "Fresh Gathering", email)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# OTP verification failures
# ---------------------------------------------------------------------------


def test_verify_with_wrong_code_returns_401(client: TestClient, db: Session) -> None:
    email = _unique_email()
    with _trial_test_env():
        assert _start_trial(client, "Wrong Code Fest", email).status_code == 200
        real_code = _get_code(db, email)
        wrong = "000000" if real_code != "000000" else "111111"

        resp = client.post(VERIFY_URL, json={"email": email, "code": wrong})
        assert resp.status_code == 401

        # Right code still works after one failed attempt
        resp = client.post(VERIFY_URL, json={"email": email, "code": real_code})
        assert resp.status_code == 201


def test_verify_locks_after_max_attempts(client: TestClient, db: Session) -> None:
    email = _unique_email()
    with _trial_test_env():
        assert _start_trial(client, "Lockout Fest", email).status_code == 200
        real_code = _get_code(db, email)
        wrong = "000000" if real_code != "000000" else "111111"

        for _ in range(5):
            resp = client.post(VERIFY_URL, json={"email": email, "code": wrong})
            assert resp.status_code == 401

        # Sixth attempt (even with the right code) is locked out
        resp = client.post(VERIFY_URL, json={"email": email, "code": real_code})
        assert resp.status_code == 429


def test_verify_with_expired_code_returns_401(client: TestClient, db: Session) -> None:
    email = _unique_email()
    with _trial_test_env():
        assert _start_trial(client, "Expired Code Fest", email).status_code == 200
        code = _get_code(db, email)

        row = db.exec(select(PendingTrials).where(PendingTrials.email == email)).first()
        row.code_expiration = datetime.now(UTC) - timedelta(minutes=1)
        db.add(row)
        db.commit()

        resp = client.post(VERIFY_URL, json={"email": email, "code": code})
        assert resp.status_code == 401


def test_verify_without_pending_returns_404(client: TestClient) -> None:
    with _trial_test_env():
        resp = client.post(
            VERIFY_URL,
            json={"email": _unique_email(), "code": "123456"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Rate limit — 3 signups per hour per IP
# ---------------------------------------------------------------------------


def test_create_trial_rate_limit_returns_429(client: TestClient) -> None:
    mock_redis = MagicMock()
    mock_redis.get.return_value = "3"  # at the limit already
    mock_redis.ttl.return_value = 120

    with patch("app.core.rate_limit.get_redis", return_value=mock_redis):
        resp = _start_trial(client, "Rate Limited Fest", _unique_email())

    assert resp.status_code == 429
    assert "Retry-After" in resp.headers


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


def test_create_trial_validates_email_and_name(client: TestClient) -> None:
    with _trial_test_env():
        resp = client.post(
            TRIALS_URL, json={"gathering_name": "X", "email": "not-an-email"}
        )
        assert resp.status_code == 422

        resp = client.post(
            TRIALS_URL, json={"gathering_name": "", "email": _unique_email()}
        )
        assert resp.status_code == 422
