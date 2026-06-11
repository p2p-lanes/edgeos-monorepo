"""Regression tests for SimpleFI webhook authenticity (forgery protection).

The webhook endpoint approves payments and issues tickets based on the
payload's ``status`` field. That payload is attacker-controllable, so two
guards were added:

1. Signature verification — a *present-but-invalid* ``X-SimpleFI-Signature``
   is rejected (the secret is the popup's ``simplefi_api_key``).
2. Authoritative status confirmation — before acting on an ``approved``
   transition we re-fetch the real status from SimpleFI server-side and trust
   the provider, so a forged ``approved`` payload cannot issue tickets.

These tests exercise the two helpers in isolation (no DB / network) so they
stay fast and deterministic.
"""

import hashlib
import hmac
import importlib
from types import SimpleNamespace

import pytest

from app.api.payment.router import (
    _confirm_simplefi_status,
    _resolve_webhook_popup_secret,
)
from app.services.simplefi import verify_webhook_signature

# `app.api.payment.router` is re-exported from the package as the APIRouter
# instance, so import the module explicitly for monkeypatching its globals.
payment_router = importlib.import_module("app.api.payment.router")


def _sign(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def test_valid_signature_accepted_invalid_rejected() -> None:
    secret = "popup-secret-key"
    body = b'{"event_type":"new_payment"}'

    assert verify_webhook_signature(body, _sign(body, secret), secret) is True
    assert verify_webhook_signature(body, "deadbeef", secret) is False
    # Tampered body with an otherwise-valid-looking signature is rejected.
    assert verify_webhook_signature(b'{"x":1}', _sign(body, secret), secret) is False


def test_resolve_secret_prefers_payment_request_id(monkeypatch) -> None:
    popup = SimpleNamespace(simplefi_api_key="key-123")
    payment = SimpleNamespace(popup=popup)

    looked_up: list[str] = []

    class FakeCRUD:
        def get_by_external_id(self, _db, external_id: str):
            looked_up.append(external_id)
            return payment if external_id == "pr-1" else None

    monkeypatch.setattr(payment_router, "payments_crud", FakeCRUD())

    raw_body = {"data": {"payment_request": {"id": "pr-1"}}, "entity_id": "ent-9"}
    assert _resolve_webhook_popup_secret(object(), raw_body) == "key-123"
    assert "pr-1" in looked_up


def test_resolve_secret_none_when_no_payment(monkeypatch) -> None:
    class FakeCRUD:
        def get_by_external_id(self, _db, _external_id: str):
            return None

    monkeypatch.setattr(payment_router, "payments_crud", FakeCRUD())
    assert _resolve_webhook_popup_secret(object(), {"entity_id": "x"}) is None


def test_forged_approved_status_overridden_by_provider(monkeypatch) -> None:
    """A forged ``approved`` payload is overridden by SimpleFI's real status."""
    popup = SimpleNamespace(simplefi_api_key="key")
    payment = SimpleNamespace(popup=popup)

    class FakeClient:
        def get_payment_request_status(self, _pr_id):
            return SimpleNamespace(id=_pr_id, status="pending")

    monkeypatch.setattr(payment_router, "get_simplefi_client", lambda _k: FakeClient())

    result = _confirm_simplefi_status(payment, "pr-1", claimed_status="approved")
    assert result == "pending"  # provider wins, so approval will NOT happen


def test_confirm_returns_provider_approved_for_genuine_payment(monkeypatch) -> None:
    popup = SimpleNamespace(simplefi_api_key="key")
    payment = SimpleNamespace(popup=popup)

    class FakeClient:
        def get_payment_request_status(self, _pr_id):
            return SimpleNamespace(id=_pr_id, status="approved")

    monkeypatch.setattr(payment_router, "get_simplefi_client", lambda _k: FakeClient())
    assert _confirm_simplefi_status(payment, "pr-1", claimed_status="approved") == (
        "approved"
    )


def test_confirm_fails_closed_when_provider_unreachable_on_approved(
    monkeypatch,
) -> None:
    from fastapi import HTTPException

    popup = SimpleNamespace(simplefi_api_key="key")
    payment = SimpleNamespace(popup=popup)

    class FakeClient:
        def get_payment_request_status(self, _pr_id):
            raise RuntimeError("simplefi down")

    monkeypatch.setattr(payment_router, "get_simplefi_client", lambda _k: FakeClient())

    with pytest.raises(HTTPException) as exc:
        _confirm_simplefi_status(payment, "pr-1", claimed_status="approved")
    assert exc.value.status_code == 502


def test_confirm_without_secret_trusts_claimed_status() -> None:
    """No API key configured (or no popup loaded) → cannot confirm, fall back."""
    payment = SimpleNamespace()  # no .popup attribute at all
    assert _confirm_simplefi_status(payment, "pr-1", claimed_status="expired") == (
        "expired"
    )


# ---------------------------------------------------------------------------
# Handler ordering: status confirmation must run BEFORE the idempotency token
# is consumed, so a fail-closed 502 doesn't suppress SimpleFI's retry.
# ---------------------------------------------------------------------------


def _approved_payload(payment_request_id: str = "pr-1"):
    from app.api.payment.schemas import SimpleFIWebhookPayload

    return SimpleFIWebhookPayload.model_validate(
        {
            "id": "evt-1",
            "event_type": "new_payment",
            "entity_type": "payment_request",
            "entity_id": payment_request_id,
            "data": {
                "payment_request": {
                    "id": payment_request_id,
                    "order_id": 1,
                    "amount": 100.0,
                    "amount_paid": 0,
                    "currency": "USD",
                    "reference": {},
                    "status": "approved",
                    "status_detail": "approved",
                    "transactions": [],
                    "card_payment": None,
                    "payments": [],
                    "installment_plan_id": None,
                },
                "new_payment": None,
            },
        }
    )


class _FakeCache:
    def __init__(self):
        self.keys: set[str] = set()

    def add(self, fingerprint: str) -> bool:
        if fingerprint in self.keys:
            return False
        self.keys.add(fingerprint)
        return True


def test_unreachable_provider_does_not_consume_fingerprint(monkeypatch) -> None:
    """Regression: a 502 (provider unreachable) on an approved webhook must not
    burn the idempotency fingerprint, or SimpleFI's retry would be dropped as
    "already processed" and the genuine payment would never be approved.
    """
    import asyncio

    from fastapi import HTTPException

    payment = SimpleNamespace(
        id="p1",
        external_id="pr-1",
        status="pending",
        payment_type="regular",
        popup=SimpleNamespace(simplefi_api_key="key"),
    )

    class _CRUD:
        def get_by_external_id(self, _db, _external_id):
            return payment

    class _DownClient:
        def get_payment_request_status(self, _pr_id):
            raise RuntimeError("simplefi down")

    monkeypatch.setattr(payment_router, "payments_crud", _CRUD())
    monkeypatch.setattr(payment_router, "get_simplefi_client", lambda _k: _DownClient())

    cache = _FakeCache()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            payment_router._handle_regular_payment(_approved_payload(), object(), cache)
        )
    assert exc.value.status_code == 502
    assert cache.keys == set()  # fingerprint NOT consumed → retry will be honored
