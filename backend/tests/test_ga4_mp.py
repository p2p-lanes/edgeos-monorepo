"""GA4 Purchase follows confirmed ticket payments without blocking checkout."""

import asyncio
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services import ga4_mp
from app.utils.encryption import encrypt


def _purchase() -> tuple[SimpleNamespace, SimpleNamespace, SimpleNamespace]:
    tenant = SimpleNamespace(
        ga_tracking_enabled=True,
        ga_measurement_id="G-TEST123",
        ga_mp_api_secret_encrypted=encrypt("private-test-secret"),
    )
    popup = SimpleNamespace(id=uuid4(), slug="summer", name="Summer", currency="USD")
    payment = SimpleNamespace(
        id=uuid4(),
        amount=Decimal("25.00"),
        amount_charged=None,
        currency="USD",
        ga_client_id="123.456",
        ga_session_id="789",
        products_snapshot=[
            SimpleNamespace(
                product_id=uuid4(),
                quantity=2,
                product_price=Decimal("12.50"),
                effective_unit_price=None,
                product_name="Weekend pass",
                product_category="ticket",
            )
        ],
    )
    return tenant, payment, popup


def test_prepare_purchase_uses_browser_identity_and_payment_id() -> None:
    tenant, payment, popup = _purchase()

    event = ga4_mp.prepare_purchase_event(tenant, payment, popup)

    assert event is not None
    assert event.measurement_id == "G-TEST123"
    assert event.payload == {
        "client_id": "123.456",
        "events": [
            {
                "name": "purchase",
                "params": {
                    "transaction_id": str(payment.id),
                    "currency": "USD",
                    "value": 25.0,
                    "items": [
                        {
                            "item_id": str(payment.products_snapshot[0].product_id),
                            "quantity": 2,
                            "price": 0,
                        }
                    ],
                    "popup_id": str(popup.id),
                    "popup_slug": "summer",
                    "popup_name": "Summer",
                    "session_id": "789",
                    "engagement_time_msec": 1,
                },
            }
        ],
    }
    assert "private-test-secret" not in repr(event)


def test_prepare_purchase_skips_missing_identity_or_non_ticket_payment() -> None:
    tenant, payment, popup = _purchase()
    payment.ga_client_id = None
    assert ga4_mp.prepare_purchase_event(tenant, payment, popup) is None

    payment.ga_client_id = "123.456"
    payment.products_snapshot[0].product_category = "merch"
    assert ga4_mp.prepare_purchase_event(tenant, payment, popup) is None


def test_send_failure_does_not_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    tenant, payment, popup = _purchase()
    event = ga4_mp.prepare_purchase_event(tenant, payment, popup)
    assert event is not None

    class FailingClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, *_args, **_kwargs):
            raise ga4_mp.httpx.ConnectError("offline")

    monkeypatch.setattr(ga4_mp.httpx, "AsyncClient", lambda **_kwargs: FailingClient())
    asyncio.run(ga4_mp.send_prepared_purchase_event(event))


def test_send_uses_private_secret_only_in_google_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant, payment, popup = _purchase()
    event = ga4_mp.prepare_purchase_event(tenant, payment, popup)
    assert event is not None
    captured: dict[str, object] = {}

    class Response:
        def raise_for_status(self) -> None:
            return None

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url: str, **kwargs: object) -> Response:
            captured.update(url=url, **kwargs)
            return Response()

    monkeypatch.setattr(ga4_mp.httpx, "AsyncClient", lambda **_kwargs: Client())
    asyncio.run(ga4_mp.send_prepared_purchase_event(event))

    assert captured == {
        "url": "https://www.google-analytics.com/mp/collect",
        "params": {
            "measurement_id": "G-TEST123",
            "api_secret": "private-test-secret",
        },
        "json": event.payload,
    }
    assert "private-test-secret" not in repr(event)
