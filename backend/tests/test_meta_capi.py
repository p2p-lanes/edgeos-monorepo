import asyncio
import json
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services import meta_capi
from app.services.meta_capi import (
    prepare_and_send_purchase_event,
    prepare_initiate_checkout_event,
    prepare_purchase_event,
    send_prepared_purchase_event,
)
from app.utils.encryption import encrypt

DUMMY_ACCESS_TOKEN = "DUMMY_META_ACCESS_TOKEN_FOR_TESTS"


def test_prepare_purchase_event_skips_when_tenant_tracking_disabled() -> None:
    tenant = SimpleNamespace(
        meta_tracking_enabled=False,
        meta_pixel_id="123",
        meta_capi_access_token_encrypted=encrypt(DUMMY_ACCESS_TOKEN),
    )
    payment = SimpleNamespace(id=uuid4())

    assert prepare_purchase_event(tenant, payment) is None


def test_prepare_purchase_event_includes_popup_purchase_metadata() -> None:
    payment_id = uuid4()
    popup_id = uuid4()
    product_id = uuid4()
    human_id = uuid4()
    human = SimpleNamespace(
        id=human_id,
        email="buyer@example.com",
        first_name="Ada",
        last_name="Lovelace",
    )
    attendee = SimpleNamespace(human=human)
    payment_product = SimpleNamespace(
        product_id=product_id,
        quantity=2,
        effective_unit_price=None,
        product_price=Decimal("12.50"),
        product_name="Weekend Pass",
        product_category="ticket",
        attendee=attendee,
    )
    payment = SimpleNamespace(
        id=payment_id,
        amount=Decimal("25.00"),
        amount_charged=None,
        currency="USD",
        products_snapshot=[payment_product],
        application=None,
        buyer_email="buyer@example.com",
        buyer_name="Ada Lovelace",
        buyer_snapshot=None,
        meta_fbc="fb.1.1710000000.click",
        meta_fbp="fb.1.1710000000.browser",
        meta_client_ip="203.0.113.10",
        meta_client_user_agent="Mozilla/5.0 Test",
    )
    popup = SimpleNamespace(
        id=popup_id,
        slug="summer-popup",
        name="Summer Popup",
        currency="USD",
    )
    tenant = SimpleNamespace(
        meta_tracking_enabled=True,
        meta_pixel_id="123456789",
        meta_capi_access_token_encrypted=encrypt(DUMMY_ACCESS_TOKEN),
    )

    event = prepare_purchase_event(tenant, payment, popup)

    assert event is not None
    # event_id is the raw order id (payment.id) for cross-partner Meta dedup.
    assert event.event_id == str(payment_id)
    payload_event = event.payload["data"][0]
    assert payload_event["event_name"] == "Purchase"
    assert payload_event["action_source"] == "website"
    assert payload_event["custom_data"] == {
        "currency": "USD",
        "value": 25.0,
        "order_id": str(payment_id),
        "content_ids": [str(product_id)],
        "contents": [
            {
                "id": str(product_id),
                "quantity": 2,
                "item_price": 12.5,
                "title": "Weekend Pass",
            }
        ],
        "num_items": 2,
        "popup_id": str(popup_id),
        "popup_slug": "summer-popup",
        "popup_name": "Summer Popup",
    }
    assert payload_event["user_data"]["em"]
    assert payload_event["user_data"]["fn"]
    assert payload_event["user_data"]["ln"]
    assert payload_event["user_data"]["external_id"]
    assert payload_event["user_data"]["fbc"] == "fb.1.1710000000.click"
    assert payload_event["user_data"]["fbp"] == "fb.1.1710000000.browser"
    assert payload_event["user_data"]["client_ip_address"] == "203.0.113.10"
    assert payload_event["user_data"]["client_user_agent"] == "Mozilla/5.0 Test"

    serialized_payload = json.dumps(event.payload)
    serialized_event = repr(event)
    assert "buyer@example.com" not in serialized_payload
    assert "Ada" not in serialized_payload
    assert "Lovelace" not in serialized_payload
    assert DUMMY_ACCESS_TOKEN not in serialized_payload
    assert DUMMY_ACCESS_TOKEN not in serialized_event


def test_prepare_purchase_event_skips_when_no_ticket_products() -> None:
    payment = SimpleNamespace(
        id=uuid4(),
        amount=Decimal("40.00"),
        amount_charged=None,
        currency="USD",
        products_snapshot=[
            SimpleNamespace(
                product_id=uuid4(),
                quantity=1,
                effective_unit_price=None,
                product_price=Decimal("40.00"),
                product_name="Travel Insurance",
                product_category="other",
                attendee=None,
            )
        ],
        application=None,
        buyer_email="buyer@example.com",
        buyer_name="Ada Lovelace",
        buyer_snapshot=None,
    )
    popup = SimpleNamespace(
        id=uuid4(),
        slug="summer-popup",
        name="Summer Popup",
        currency="USD",
    )
    tenant = SimpleNamespace(
        meta_tracking_enabled=True,
        meta_pixel_id="123456789",
        meta_capi_access_token_encrypted=encrypt(DUMMY_ACCESS_TOKEN),
    )

    assert prepare_purchase_event(tenant, payment, popup) is None


def test_prepare_initiate_checkout_event_uses_payment_currency_without_order_id() -> (
    None
):
    payment_id = uuid4()
    popup_id = uuid4()
    product_id = uuid4()
    payment = SimpleNamespace(
        id=payment_id,
        amount=Decimal("15000.00"),
        amount_charged=None,
        currency="ARS",
        products_snapshot=[
            SimpleNamespace(
                product_id=product_id,
                quantity=2,
                effective_unit_price=None,
                product_price=Decimal("7500.00"),
                product_name="General Admission",
                attendee=SimpleNamespace(
                    human=SimpleNamespace(
                        id=uuid4(),
                        email="buyer@example.com",
                        first_name="Ada",
                        last_name="Lovelace",
                    )
                ),
            )
        ],
        application=None,
        buyer_email="buyer@example.com",
        buyer_name="Ada Lovelace",
        buyer_snapshot=None,
        meta_fbc="fb.1.1710000000.click",
        meta_fbp="fb.1.1710000000.browser",
        meta_client_ip="203.0.113.10",
        meta_client_user_agent="Mozilla/5.0 Test",
    )
    popup = SimpleNamespace(
        id=popup_id,
        slug="summer-popup",
        name="Summer Popup",
        currency="ARS",
    )
    tenant = SimpleNamespace(
        meta_tracking_enabled=True,
        meta_pixel_id="123456789",
        meta_capi_access_token_encrypted=encrypt(DUMMY_ACCESS_TOKEN),
    )

    event = prepare_initiate_checkout_event(tenant, payment, popup)

    assert event is not None
    assert event.event_name == "InitiateCheckout"
    assert event.event_id == f"EVT_INITIATE_CHECKOUT_{payment_id}"
    payload_event = event.payload["data"][0]
    assert payload_event["event_name"] == "InitiateCheckout"
    assert payload_event["custom_data"] == {
        "currency": "ARS",
        "value": 15000.0,
        "content_ids": [str(product_id)],
        "contents": [
            {
                "id": str(product_id),
                "quantity": 2,
                "item_price": 7500.0,
                "title": "General Admission",
            }
        ],
        "num_items": 2,
        "popup_id": str(popup_id),
        "popup_slug": "summer-popup",
        "popup_name": "Summer Popup",
    }
    assert "order_id" not in payload_event["custom_data"]
    assert payload_event["user_data"]["fbc"] == "fb.1.1710000000.click"
    assert payload_event["user_data"]["fbp"] == "fb.1.1710000000.browser"


def test_prepare_purchase_event_skips_invalid_pixel_id() -> None:
    tenant = SimpleNamespace(
        meta_tracking_enabled=True,
        meta_pixel_id="123/../../events?access_token=leak",
        meta_capi_access_token_encrypted=encrypt(DUMMY_ACCESS_TOKEN),
    )
    payment = SimpleNamespace(id=uuid4())

    assert prepare_purchase_event(tenant, payment) is None


def test_send_prepared_purchase_event_sends_token_in_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        headers = {"x-fb-trace-id": "trace-123"}

        def raise_for_status(self) -> None:
            return None

    class FakeAsyncClient:
        def __init__(self, *, timeout: float) -> None:
            captured["timeout"] = timeout

        async def __aenter__(self) -> "FakeAsyncClient":
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def post(self, url: str, **kwargs: object) -> FakeResponse:
            captured["url"] = url
            captured["kwargs"] = kwargs
            return FakeResponse()

    monkeypatch.setattr(meta_capi.httpx, "AsyncClient", FakeAsyncClient)
    event = meta_capi.PreparedMetaCapiPurchase(
        pixel_id="123456789",
        encrypted_access_token=encrypt(DUMMY_ACCESS_TOKEN),
        payload={"data": [{"event_name": "Purchase"}]},
        event_id="event-1",
        payment_id="payment-1",
        popup_id="popup-1",
    )

    asyncio.run(send_prepared_purchase_event(event))

    kwargs = captured["kwargs"]
    assert isinstance(kwargs, dict)
    assert "params" not in kwargs
    assert kwargs["json"] == {
        "data": [{"event_name": "Purchase"}],
        "access_token": DUMMY_ACCESS_TOKEN,
    }
    assert DUMMY_ACCESS_TOKEN not in str(captured["url"])


def test_prepare_and_send_purchase_event_is_failure_safe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_prepare(**_kwargs: object) -> None:
        raise RuntimeError("prepare failed")

    monkeypatch.setattr(meta_capi, "prepare_purchase_event", fail_prepare)

    asyncio.run(
        prepare_and_send_purchase_event(
            tenant=SimpleNamespace(),
            payment=SimpleNamespace(id="payment-1"),
            popup=SimpleNamespace(),
        )
    )
