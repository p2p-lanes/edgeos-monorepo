"""Unit tests for Payments.amount_charged — the settled total from SimpleFi.

SimpleFi merchants can configure signed per-rail price adjustments (card /
crypto), so the amount the buyer is actually charged can differ from the
quoted ``Payments.amount``. Three behaviors under test:

  1. ``_extract_charged_amount`` picks the card-rail adjusted fiat total when
     a card payment is present, and the crypto-rail total otherwise. It must
     NOT use ``amount_paid`` for card checkouts — SimpleFi normalizes the
     discount back out of that field.
  2. ``_handle_regular_payment`` records amount_charged on approval.
  3. ``_handle_installment_payment`` accumulates amount_charged across
     installments in fiat (not in the paying coin).

Same monkey-patching style as test_installment_webhooks.py: handlers are
exercised in isolation against minimal fakes.
"""

import asyncio
import importlib
from decimal import Decimal
from types import SimpleNamespace

from app.api.payment.router import (
    _extract_charged_amount,
    _handle_installment_payment,
    _handle_regular_payment,
    _installment_charged_amount,
)
from app.api.payment.schemas import (
    PaymentStatus,
    SimpleFIPaymentRequest,
    SimpleFIWebhookPayload,
)

payment_router_module = importlib.import_module("app.api.payment.router")


class FakeWebhookCache:
    def __init__(self) -> None:
        self.fingerprints: set[str] = set()

    def add(self, fingerprint: str) -> bool:
        if fingerprint in self.fingerprints:
            return False
        self.fingerprints.add(fingerprint)
        return True


class FakeDBSession:
    def __init__(self) -> None:
        self.committed = 0

    def commit(self) -> None:
        self.committed += 1

    def add(self, _obj) -> None:
        pass


def _payment_request_dict(
    pr_id: str = "pr-1",
    *,
    amount: float = 100.0,
    amount_paid: float = 100.0,
    card_payment: dict | None = None,
    installment_plan_id: str | None = None,
) -> dict:
    return {
        "id": pr_id,
        "order_id": 1,
        "amount": amount,
        "amount_paid": amount_paid,
        "currency": "USD",
        "reference": {},
        "status": "approved",
        "status_detail": "correct",
        "transactions": [],
        "card_payment": card_payment,
        "payments": [],
        "installment_plan_id": installment_plan_id,
    }


def _card_payment_dict(final_amount: float) -> dict:
    return {
        "provider": "stripe",
        "status": "correct",
        "coin": "USD",
        "price_details": {
            "currency": "USD",
            "final_amount": final_amount,
            "rate": 1.0,
        },
    }


# ----------------------------------------------------------------------------
# _extract_charged_amount / _installment_charged_amount
# ----------------------------------------------------------------------------


def test_charged_amount_card_uses_final_amount() -> None:
    """Quoted 100, card pricing -25%: buyer is charged 75. amount_paid is
    normalized back to ~100 by SimpleFi and must be ignored."""
    pr = SimpleFIPaymentRequest.model_validate(
        _payment_request_dict(
            amount=100.0,
            amount_paid=100.0,
            card_payment=_card_payment_dict(75.0),
        )
    )
    assert _extract_charged_amount(pr) == Decimal("75.0")


def test_charged_amount_crypto_uses_request_amount() -> None:
    """No card payment: the request's legacy `amount` scalar is the
    crypto-rail adjusted total."""
    pr = SimpleFIPaymentRequest.model_validate(
        _payment_request_dict(amount=80.0, amount_paid=80.0)
    )
    assert _extract_charged_amount(pr) == Decimal("80.0")


def test_charged_amount_card_without_price_details_falls_back() -> None:
    """Older payloads may omit price_details — fall back to the request amount
    rather than crash."""
    card = _card_payment_dict(75.0)
    del card["price_details"]
    pr = SimpleFIPaymentRequest.model_validate(
        _payment_request_dict(amount=100.0, card_payment=card)
    )
    assert _extract_charged_amount(pr) == Decimal("100.0")


def test_installment_charged_amount_subscription_uses_amount_paid() -> None:
    """Subscription installments (Stripe/MP) report the debited card amount
    directly in amount_paid."""
    pr = SimpleFIPaymentRequest.model_validate(
        _payment_request_dict(amount=600.0, amount_paid=75.0)
    )
    assert _installment_charged_amount(pr) == Decimal("75.0")


def test_installment_charged_amount_card_checkout_uses_final_amount() -> None:
    pr = SimpleFIPaymentRequest.model_validate(
        _payment_request_dict(
            amount=100.0,
            amount_paid=100.0,
            card_payment=_card_payment_dict(75.0),
        )
    )
    assert _installment_charged_amount(pr) == Decimal("75.0")


# ----------------------------------------------------------------------------
# _handle_regular_payment records amount_charged on approval
# ----------------------------------------------------------------------------


def _make_regular_card_payload(pr_id: str, final_amount: float) -> SimpleFIWebhookPayload:
    return SimpleFIWebhookPayload.model_validate(
        {
            "id": "evt-regular-1",
            "event_type": "new_card_payment",
            "entity_type": "payment_request",
            "entity_id": pr_id,
            "data": {
                "payment_request": _payment_request_dict(
                    pr_id,
                    amount=100.0,
                    amount_paid=100.0,
                    card_payment=_card_payment_dict(final_amount),
                ),
                "new_payment": None,
            },
        }
    )


def test_regular_payment_approval_records_amount_charged(monkeypatch) -> None:
    pr_id = "pr-regular-1"
    payment = SimpleNamespace(
        id="payment-regular-1",
        external_id=pr_id,
        status=PaymentStatus.PENDING.value,
        payment_type="pass_purchase",
        amount_charged=None,
    )

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, _ext_id):
            return payment

        def approve_payment(self, _db, _payment_id, **_kw):
            payment.status = PaymentStatus.APPROVED.value
            return payment

    async def fake_send_email(_payment, **_kwargs):
        return None

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())
    monkeypatch.setattr(
        payment_router_module, "_send_payment_confirmed_email", fake_send_email
    )

    result = asyncio.run(
        _handle_regular_payment(
            _make_regular_card_payload(pr_id, 75.0),
            FakeDBSession(),
            FakeWebhookCache(),
        )
    )

    assert result == {"message": "Payment status updated successfully"}
    assert payment.status == PaymentStatus.APPROVED.value
    assert payment.amount_charged == Decimal("75.0")


def test_regular_payment_expiry_leaves_amount_charged_null(monkeypatch) -> None:
    pr_id = "pr-regular-expired"
    payment = SimpleNamespace(
        id="payment-regular-expired",
        external_id=pr_id,
        status=PaymentStatus.PENDING.value,
        payment_type="pass_purchase",
        amount_charged=None,
    )

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, _ext_id):
            return payment

        def update_status(self, _db, _payment_id, _status):
            payment.status = PaymentStatus.EXPIRED.value

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    payload = _make_regular_card_payload(pr_id, 75.0)
    payload.data.payment_request.status = "expired"

    asyncio.run(
        _handle_regular_payment(payload, FakeDBSession(), FakeWebhookCache())
    )

    assert payment.status == PaymentStatus.EXPIRED.value
    assert payment.amount_charged is None


# ----------------------------------------------------------------------------
# _handle_installment_payment accumulates amount_charged
# ----------------------------------------------------------------------------


def _make_installment_payload(
    plan_id: str, pr_id: str, *, amount_paid: float
) -> SimpleFIWebhookPayload:
    return SimpleFIWebhookPayload.model_validate(
        {
            "id": f"evt-{pr_id}",
            "event_type": "new_card_payment",
            "entity_type": "payment_request",
            "entity_id": pr_id,
            "data": {
                "payment_request": _payment_request_dict(
                    pr_id,
                    amount=600.0,
                    amount_paid=amount_paid,
                    installment_plan_id=plan_id,
                ),
                "new_payment": None,
            },
        }
    )


def test_installment_payments_accumulate_amount_charged(monkeypatch) -> None:
    """Each settled installment adds its charged fiat amount; after two
    installments of 75 the payment carries 150 regardless of the quoted total."""
    plan_id = "plan-charge-1"
    payment = SimpleNamespace(
        id="payment-charge-1",
        external_id=plan_id,
        status=PaymentStatus.APPROVED.value,
        tenant_id="tenant-x",
        installments=[],
        installments_paid=0,
        installments_total=6,
        amount_charged=None,
        source="SimpleFI",
    )

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, _ext_id):
            return payment

        def approve_payment(self, _db, _payment_id, **_kw):
            raise AssertionError("already approved; must not re-approve")

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    db = FakeDBSession()
    asyncio.run(
        _handle_installment_payment(
            _make_installment_payload(plan_id, "pr-charge-1", amount_paid=75.0),
            db,
            FakeWebhookCache(),
        )
    )
    assert payment.amount_charged == Decimal("75.0")
    assert payment.installments_paid == 1

    # Second installment arrives; payment.installments must reflect the first
    # row for dedupe/numbering, so seed it the way the handler would have.
    payment.installments = [
        SimpleNamespace(external_payment_id="pr-charge-1", installment_number=1)
    ]
    asyncio.run(
        _handle_installment_payment(
            _make_installment_payload(plan_id, "pr-charge-2", amount_paid=75.0),
            db,
            FakeWebhookCache(),
        )
    )
    assert payment.amount_charged == Decimal("150.0")
    assert payment.installments_paid == 2
