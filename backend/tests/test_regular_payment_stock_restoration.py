"""Regression test for W-1: _handle_regular_payment else-branch stock restoration.

TDD phase: RED — written BEFORE the one-line fix.

Background (W-1, Slice 3 verify report):
    _handle_regular_payment fires for event_type in {new_payment, new_card_payment}.
    When payment_request_status != "approved" the ORIGINAL code called:
        payments_crud.update(db, payment, PaymentUpdate(status=PaymentStatus.EXPIRED))
    This bypassed update_status() and therefore bypassed _restore_payment_stock.

    Fix: replace that call with:
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

This test asserts:
    1. The else-branch calls update_status (not update) — verified via AssertionError on update().
    2. update_status is called with (payment.id, PaymentStatus.EXPIRED).

Spec reference: §Domain 3 "Webhook Handlers Restore Both Counters" — the regular-payment
non-approved path must also run through the same restoration codepath.
"""

import asyncio
from types import SimpleNamespace

import importlib
import pytest

from app.api.payment.router import _handle_regular_payment
from app.api.payment.schemas import PaymentStatus, SimpleFIWebhookPayload

payment_router_module = importlib.import_module("app.api.payment.router")


class FakeWebhookCache:
    def __init__(self) -> None:
        self.fingerprints: set[str] = set()

    def add(self, fingerprint: str) -> bool:
        if fingerprint in self.fingerprints:
            return False
        self.fingerprints.add(fingerprint)
        return True


def _make_new_payment_payload(
    payment_request_id: str,
    provider_status: str = "failed",
    event_type: str = "new_payment",
) -> SimpleFIWebhookPayload:
    return SimpleFIWebhookPayload.model_validate(
        {
            "id": "evt-new-pay-1",
            "event_type": event_type,
            "entity_type": "payment_request",
            "entity_id": payment_request_id,
            "data": {
                "payment_request": {
                    "id": payment_request_id,
                    "order_id": 42,
                    "amount": 100.0,
                    "amount_paid": 0,
                    "currency": "USD",
                    "reference": {},
                    "status": provider_status,
                    "status_detail": provider_status,
                    "transactions": [],
                    "card_payment": None,
                    "payments": [],
                    "installment_plan_id": None,
                },
                "new_payment": None,
            },
        }
    )


def test_non_approved_new_payment_calls_update_status_not_update(monkeypatch) -> None:
    """W-1 regression: the else-branch must call update_status so stock is restored.

    This test FAILS before the fix because the old code calls payments_crud.update()
    which triggers the AssertionError sentinel below.
    """
    external_id = "simplefi-regular-pr-1"
    payment = SimpleNamespace(
        id="payment-1",
        external_id=external_id,
        status=PaymentStatus.PENDING.value,
        payment_type="regular",
    )

    update_status_called_with = []

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, requested_external_id: str):
            assert requested_external_id == external_id
            return payment

        def update(self, _db, db_obj, obj_in):
            raise AssertionError(
                "update() must NOT be called — use update_status() so "
                "_restore_payment_stock runs (W-1 fix required)"
            )

        def update_status(self, _db, payment_id, new_status):
            update_status_called_with.append((payment_id, new_status))
            payment.status = new_status.value
            return payment

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    result = asyncio.run(
        _handle_regular_payment(
            _make_new_payment_payload(external_id, provider_status="expired"),
            object(),
            FakeWebhookCache(),
        )
    )

    # Handler must complete successfully
    assert result == {"message": "Payment status updated successfully"}
    # update_status was called exactly once with the right arguments
    assert len(update_status_called_with) == 1
    payment_id, new_status = update_status_called_with[0]
    assert payment_id == payment.id
    assert new_status == PaymentStatus.EXPIRED


def test_non_approved_new_card_payment_calls_update_status(monkeypatch) -> None:
    """Same W-1 fix: new_card_payment event type should also use update_status."""
    external_id = "simplefi-regular-card-pr-1"
    payment = SimpleNamespace(
        id="payment-2",
        external_id=external_id,
        status=PaymentStatus.PENDING.value,
        payment_type="regular",
    )

    update_status_called_with = []

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, requested_external_id: str):
            return payment

        def update(self, _db, db_obj, obj_in):
            raise AssertionError("update() must NOT be called — W-1 fix required")

        def update_status(self, _db, payment_id, new_status):
            update_status_called_with.append((payment_id, new_status))
            payment.status = new_status.value
            return payment

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    result = asyncio.run(
        _handle_regular_payment(
            _make_new_payment_payload(
                external_id,
                provider_status="expired",
                event_type="new_card_payment",
            ),
            object(),
            FakeWebhookCache(),
        )
    )

    assert result == {"message": "Payment status updated successfully"}
    assert len(update_status_called_with) == 1
    _, new_status = update_status_called_with[0]
    assert new_status == PaymentStatus.EXPIRED
