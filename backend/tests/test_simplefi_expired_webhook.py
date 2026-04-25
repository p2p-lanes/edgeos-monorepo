import asyncio
import importlib
from types import SimpleNamespace

from app.api.payment.router import _handle_payment_request_expired
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


def _make_expired_payload(payment_request_id: str) -> SimpleFIWebhookPayload:
    return SimpleFIWebhookPayload.model_validate(
        {
            "id": "evt-expired-1",
            "event_type": "payment_request_expired",
            "entity_type": "payment_request",
            "entity_id": payment_request_id,
            "data": {
                "payment_request": {
                    "id": payment_request_id,
                    "order_id": 323,
                    "amount": 119.2,
                    "amount_paid": 0,
                    "currency": "USD",
                    "reference": {},
                    "status": "expired",
                    "status_detail": "expired",
                    "transactions": [],
                    "card_payment": None,
                    "payments": [],
                    "installment_plan_id": None,
                },
                "new_payment": None,
            },
        }
    )


def test_payment_request_expired_webhook_marks_pending_payment_expired(
    monkeypatch,
) -> None:
    external_id = "simplefi-expired-pr-1"
    payment = SimpleNamespace(
        id="payment-1",
        external_id=external_id,
        status=PaymentStatus.PENDING.value,
    )

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, requested_external_id: str):
            assert requested_external_id == external_id
            return payment

        def update(self, _db, db_obj, obj_in):
            update_data = obj_in.model_dump(exclude_unset=True)
            for field, value in update_data.items():
                setattr(db_obj, field, value.value if hasattr(value, "value") else value)
            return db_obj

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    result = asyncio.run(
        _handle_payment_request_expired(
            _make_expired_payload(external_id),
            object(),
            FakeWebhookCache(),
        )
    )

    assert result == {"message": "Payment marked as expired"}
    assert payment.status == PaymentStatus.EXPIRED.value


def test_payment_request_expired_webhook_does_not_expire_approved_payment(
    monkeypatch,
) -> None:
    external_id = "simplefi-approved-pr-1"
    payment = SimpleNamespace(
        id="payment-1",
        external_id=external_id,
        status=PaymentStatus.APPROVED.value,
    )

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, requested_external_id: str):
            assert requested_external_id == external_id
            return payment

        def update(self, _db, db_obj, obj_in):
            raise AssertionError("Approved payments must not be expired")

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    result = asyncio.run(
        _handle_payment_request_expired(
            _make_expired_payload(external_id),
            object(),
            FakeWebhookCache(),
        )
    )

    assert result == {"message": "Payment already approved"}
    assert payment.status == PaymentStatus.APPROVED.value
