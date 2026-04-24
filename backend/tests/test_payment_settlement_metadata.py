from decimal import Decimal
from types import SimpleNamespace

from app.api.payment.router import (
    _build_payment_confirmed_context,
    _extract_settlement_details,
)
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


def test_build_payment_confirmed_context_populates_attendees_and_order_summary() -> None:
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
