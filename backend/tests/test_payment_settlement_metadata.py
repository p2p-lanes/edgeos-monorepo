from decimal import Decimal
from types import SimpleNamespace

from app.api.payment.router import _extract_settlement_details
from app.api.payment.schemas import SimpleFIWebhookPayload
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
