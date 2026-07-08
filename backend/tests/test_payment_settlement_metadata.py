import asyncio
import importlib
import json
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request

from app.api.payment.router import (
    _build_payment_confirmed_context,
    _extract_meta_attribution,
    _extract_settlement_details,
    _handle_regular_payment,
    _verify_simplefi_webhook_or_raise,
    simplefi_webhook,
)
from app.api.payment.schemas import PaymentStatus, PaymentType, SimpleFIWebhookPayload
from app.services.email.service import compute_order_summary


def test_extract_settlement_details_for_crypto_payment() -> None:
    payload = SimpleFIWebhookPayload.model_validate(
        {
            "id": "evt-1",
            "event_type": "new_payment",
            "entity_type": "payment_request",
            "entity_id": "pr-1",
            "data": {
                "payment_request": {
                    "id": "pr-1",
                    "order_id": 1,
                    "amount": 120.0,
                    "amount_paid": 0.0013,
                    "currency": "USD",
                    "reference": {},
                    "status": "approved",
                    "status_detail": "approved",
                    "transactions": [
                        {
                            "id": "tx-1",
                            "coin": "BTC",
                            "chain_id": 1,
                            "status": "approved",
                            "price_details": {
                                "currency": "USD",
                                "final_amount": 120.0,
                                "rate": 92000.0,
                            },
                        }
                    ],
                    "card_payment": None,
                    "payments": [
                        {
                            "coin": "BTC",
                            "hash": "hash-1",
                            "amount": 0.0013,
                            "paid_at": "2026-04-17T12:00:00Z",
                        }
                    ],
                    "installment_plan_id": None,
                },
                "new_payment": {
                    "coin": "BTC",
                    "hash": "hash-1",
                    "amount": 0.0013,
                    "paid_at": "2026-04-17T12:00:00Z",
                },
            },
        }
    )

    settlement_currency, settlement_rate, source = _extract_settlement_details(payload)

    assert settlement_currency == "BTC"
    assert settlement_rate == Decimal("92000.0")
    assert source == "SimpleFI"


def test_extract_settlement_details_for_card_provider() -> None:
    payload = SimpleFIWebhookPayload.model_validate(
        {
            "id": "evt-2",
            "event_type": "new_card_payment",
            "entity_type": "payment_request",
            "entity_id": "pr-2",
            "data": {
                "payment_request": {
                    "id": "pr-2",
                    "order_id": 2,
                    "amount": 150000.0,
                    "amount_paid": 150000.0,
                    "currency": "ARS",
                    "reference": {},
                    "status": "approved",
                    "status_detail": "approved",
                    "transactions": [
                        {
                            "id": "tx-2",
                            "coin": "ARS",
                            "chain_id": 0,
                            "status": "approved",
                            "price_details": {
                                "currency": "ARS",
                                "final_amount": 150000.0,
                                "rate": 1.0,
                            },
                        }
                    ],
                    "card_payment": {
                        "provider": "mercado pago",
                        "status": "approved",
                        "coin": "ARS",
                    },
                    "payments": [],
                    "installment_plan_id": None,
                },
                "new_payment": {
                    "provider": "mercado pago",
                    "status": "approved",
                    "coin": "ARS",
                },
            },
        }
    )

    settlement_currency, settlement_rate, source = _extract_settlement_details(payload)

    assert settlement_currency == "ARS"
    assert settlement_rate == Decimal("1.0")
    assert source == "MercadoPago"


def test_compute_order_summary_uses_snapshot_currency() -> None:
    payment = SimpleNamespace(
        currency="BTC",
        products_snapshot=[
            SimpleNamespace(
                product_name="VIP Pass",
                attendee=SimpleNamespace(name="Ana"),
                product_price=Decimal("120.00"),
                product_currency="EUR",
            )
        ],
    )

    summary = compute_order_summary(payment)

    assert "€120.00" in summary
    assert "BTC" not in summary


def test_build_payment_confirmed_context_populates_attendees_and_order_summary() -> (
    None
):
    payment = SimpleNamespace(
        id="payment-1",
        amount=Decimal("230.00"),
        currency="USD",
        discount_value=Decimal("10"),
        products_snapshot=[
            SimpleNamespace(
                attendee_id="attendee-1",
                attendee=SimpleNamespace(name="Ana", category="main"),
                attendee_name="Ana",
                product_name="VIP Pass",
                product_price=Decimal("120.00"),
                quantity=1,
                product_currency="USD",
            ),
            SimpleNamespace(
                attendee_id="attendee-2",
                attendee=SimpleNamespace(name="Beto", category="companion"),
                attendee_name="Beto",
                product_name="Camp Ticket",
                product_price=Decimal("55.00"),
                quantity=2,
                product_currency="USD",
            ),
        ],
    )

    context = _build_payment_confirmed_context(
        payment,
        popup_name="Edge Summit",
        first_name="Ana",
        portal_url="https://portal.example.com",
    )

    assert context.first_name == "Ana"
    assert context.popup_name == "Edge Summit"
    assert context.discount_value == 10
    assert context.original_amount == 230.0
    assert context.order_summary is not None
    assert "VIP Pass" in context.order_summary
    assert "Camp Ticket" in context.order_summary
    assert context.attendees is not None
    assert len(context.attendees) == 2
    assert context.attendees[0].name == "Ana"
    assert context.attendees[0].products is not None
    assert context.attendees[0].products[0].name == "VIP Pass"
    assert context.attendees[1].name == "Beto"
    assert context.attendees[1].products is not None
    assert context.attendees[1].products[0].quantity == 2


def test_regular_payment_webhook_schedules_meta_capi_purchase(monkeypatch) -> None:
    payload = SimpleFIWebhookPayload.model_validate(
        {
            "id": "evt-meta-1",
            "event_type": "new_card_payment",
            "entity_type": "payment_request",
            "entity_id": "pr-meta-1",
            "data": {
                "payment_request": {
                    "id": "pr-meta-1",
                    "order_id": 2,
                    "amount": 150.0,
                    "amount_paid": 150.0,
                    "currency": "USD",
                    "reference": {},
                    "status": "approved",
                    "status_detail": "approved",
                    "transactions": [],
                    "card_payment": {
                        "provider": "stripe",
                        "status": "approved",
                        "coin": "USD",
                        "price_details": {
                            "currency": "USD",
                            "final_amount": 150.0,
                            "rate": 1.0,
                        },
                    },
                    "payments": [],
                    "installment_plan_id": None,
                },
                "new_payment": {
                    "provider": "stripe",
                    "status": "approved",
                    "coin": "USD",
                },
            },
        }
    )
    payment = SimpleNamespace(
        id="payment-meta-1",
        external_id="pr-meta-1",
        status=PaymentStatus.PENDING.value,
        payment_type=PaymentType.PASS_PURCHASE.value,
    )
    approved_payment = SimpleNamespace(
        id="payment-meta-1",
        tenant="tenant-snapshot",
        popup="popup-snapshot",
    )
    calls: dict[str, object] = {}

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db: object, external_id: str) -> object:
            calls["external_id"] = external_id
            return payment

        def approve_payment(
            self, _db: object, payment_id: object, **kwargs: object
        ) -> object:
            calls["approved"] = (payment_id, kwargs)
            return approved_payment

        def update_status(self, *_args: object, **_kwargs: object) -> None:
            raise AssertionError("update_status should not be called")

    class FakeWebhookCache:
        def add(self, fingerprint: str) -> bool:
            calls["fingerprint"] = fingerprint
            return True

    async def fake_email(*_args: object, **_kwargs: object) -> None:
        calls["email"] = True

    def fake_schedule(payment_arg: object) -> None:
        calls["meta"] = payment_arg

    payment_router = importlib.import_module("app.api.payment.router")
    payment_notifications = importlib.import_module(
        "app.services.payment_notifications"
    )
    monkeypatch.setattr(payment_router, "payments_crud", FakePaymentsCRUD())
    # _send_payment_confirmed_email_best_effort (called by _handle_regular_payment
    # via the webhook path) now lives in app.services.payment_notifications and
    # calls _send_payment_confirmed_email from the same module.  Patch at the
    # service-module level so the mock is visible to the service function.
    monkeypatch.setattr(
        payment_notifications, "_send_payment_confirmed_email", fake_email
    )
    monkeypatch.setattr(payment_router, "_schedule_meta_capi_purchase", fake_schedule)

    result = asyncio.run(
        _handle_regular_payment(payload, db=object(), webhook_cache=FakeWebhookCache())
    )

    assert result == {"message": "Payment status updated successfully"}
    assert calls["external_id"] == "pr-meta-1"
    assert calls["email"] is True
    assert calls["meta"] == approved_payment


def test_regular_payment_webhook_schedules_meta_capi_when_email_fails(
    monkeypatch,
) -> None:
    payload = SimpleFIWebhookPayload.model_validate(
        {
            "id": "evt-meta-email-fail",
            "event_type": "new_card_payment",
            "entity_type": "payment_request",
            "entity_id": "pr-meta-email-fail",
            "data": {
                "payment_request": {
                    "id": "pr-meta-email-fail",
                    "order_id": 2,
                    "amount": 150.0,
                    "amount_paid": 150.0,
                    "currency": "USD",
                    "reference": {},
                    "status": "approved",
                    "status_detail": "approved",
                    "transactions": [],
                    "card_payment": None,
                    "payments": [],
                    "installment_plan_id": None,
                },
                "new_payment": {
                    "provider": "stripe",
                    "status": "approved",
                    "coin": "USD",
                },
            },
        }
    )
    payment = SimpleNamespace(
        id="payment-meta-email-fail",
        external_id="pr-meta-email-fail",
        status=PaymentStatus.PENDING.value,
        payment_type=PaymentType.PASS_PURCHASE.value,
    )
    approved_payment = SimpleNamespace(
        id="payment-meta-email-fail",
        tenant="tenant-snapshot",
        popup="popup-snapshot",
    )
    calls: dict[str, object] = {}

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db: object, _external_id: str) -> object:
            return payment

        def approve_payment(self, *_args: object, **_kwargs: object) -> object:
            return approved_payment

        def update_status(self, *_args: object, **_kwargs: object) -> None:
            raise AssertionError("update_status should not be called")

    class FakeWebhookCache:
        def add(self, _fingerprint: str) -> bool:
            return True

    async def failing_email(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("email unavailable")

    def fake_schedule(payment_arg: object) -> None:
        calls["meta"] = payment_arg

    payment_router = importlib.import_module("app.api.payment.router")
    payment_notifications = importlib.import_module(
        "app.services.payment_notifications"
    )
    monkeypatch.setattr(payment_router, "payments_crud", FakePaymentsCRUD())
    monkeypatch.setattr(
        payment_notifications, "_send_payment_confirmed_email", failing_email
    )
    monkeypatch.setattr(payment_router, "_schedule_meta_capi_purchase", fake_schedule)

    result = asyncio.run(
        _handle_regular_payment(payload, db=object(), webhook_cache=FakeWebhookCache())
    )

    assert result == {"message": "Payment status updated successfully"}
    assert calls["meta"] == approved_payment


def test_meta_attribution_ignores_malformed_browser_ids_and_bounds_user_agent() -> None:
    request = Request(
        {
            "type": "http",
            "headers": [
                (b"user-agent", ("Mozilla/5.0" + "x" * 800).encode()),
                (b"x-forwarded-for", b"not-an-ip," + b"9" * 600),
            ],
            "client": ("203.0.113.10", 12345),
        }
    )

    attribution = _extract_meta_attribution(
        request,
        fbc="javascript:alert(1)",
        fbp="fb.1.not-a-timestamp.browser",
    )

    assert attribution["fbc"] is None
    assert attribution["fbp"] is None
    assert attribution["client_ip"] == "203.0.113.10"
    assert len(attribution["client_user_agent"] or "") == 512


def test_simplefi_webhook_accepts_known_payment_without_signature(monkeypatch) -> None:
    raw_body = {
        "event_type": "new_payment",
        "data": {"payment_request": {"id": "pr-known-payment"}},
    }

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db: object, _external_id: str) -> object:
            return SimpleNamespace(
                id="payment-known",
                popup=SimpleNamespace(simplefi_api_key="simplefi-api-key"),
            )

    payment_router = importlib.import_module("app.api.payment.router")
    monkeypatch.setattr(payment_router, "payments_crud", FakePaymentsCRUD())

    _verify_simplefi_webhook_or_raise(raw_body, db=object())


def test_simplefi_webhook_rejects_unknown_payment_without_caching(
    monkeypatch,
) -> None:
    raw_body = {
        "id": "evt-unknown-payment",
        "event_type": "new_payment",
        "entity_type": "payment_request",
        "entity_id": "pr-unknown-payment",
        "data": {
            "payment_request": {
                "id": "pr-unknown-payment",
                "order_id": 1,
                "amount": 120.0,
                "amount_paid": 120.0,
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
    raw_payload = json.dumps(raw_body).encode()

    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": raw_payload, "more_body": False}

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/webhook/simplefi",
            "headers": [],
            "client": ("203.0.113.10", 12345),
        },
        receive,
    )

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db: object, external_id: str) -> None:
            assert external_id == "pr-unknown-payment"
            return None

    class FakeWebhookCache:
        fingerprints: list[str] = []

        def add(self, fingerprint: str) -> bool:
            self.fingerprints.append(fingerprint)
            return True

    payment_router = importlib.import_module("app.api.payment.router")
    redis_module = importlib.import_module("app.core.redis")
    fake_cache = FakeWebhookCache()
    monkeypatch.setattr(payment_router, "payments_crud", FakePaymentsCRUD())
    monkeypatch.setattr(redis_module, "webhook_cache", fake_cache)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(simplefi_webhook(request, db=object()))

    assert exc_info.value.status_code == 404
    assert fake_cache.fingerprints == []
