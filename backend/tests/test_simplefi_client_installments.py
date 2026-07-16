"""Unit tests for SimpleFi client installment-plan branching.

Exercises the dispatch logic in ``SimpleFIClient.create_payment``: the
``/payment_requests`` endpoint must be hit when ``max_installments`` is None
or below 2; the ``/installment_plans`` endpoint must be hit when
``max_installments`` is 2+, with the buyer-pickable ceiling sent (not a fixed
``number_of_installments``).
"""

from decimal import Decimal

import pytest

from app.services.simplefi.client import SimpleFIClient, SimpleFIPaymentResponse


class _StubResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def json(self) -> dict:
        return self._payload


def _install_capture(monkeypatch, response_payload: dict) -> dict:
    """Patch the client's HTTP call and return a dict that captures invocations."""
    captured: dict = {}

    def fake_make_request(_self, method: str, endpoint: str, json=None):
        captured["method"] = method
        captured["endpoint"] = endpoint
        captured["body"] = json
        return response_payload

    monkeypatch.setattr(SimpleFIClient, "_make_request", fake_make_request)
    return captured


def test_create_payment_one_shot_hits_payment_requests(monkeypatch) -> None:
    captured = _install_capture(
        monkeypatch,
        {"id": "pr-1", "status": "pending", "checkout_v2_url": "https://pay/x"},
    )
    client = SimpleFIClient("fake-key")

    result = client.create_payment(
        amount=Decimal("100.00"),
        popup_slug="popup",
        tenant_slug="tenant",
    )

    assert captured["endpoint"] == "/payment_requests"
    assert captured["method"] == "POST"
    assert "max_installments" not in captured["body"]
    assert "interval" not in captured["body"]
    assert captured["body"]["amount"] == 100.0
    # Manual is SimpleFi's default and must be sent explicitly unless overridden.
    assert captured["body"]["redirect_urls"]["success_behavior"] == "manual"
    assert isinstance(result, SimpleFIPaymentResponse)
    assert result.is_installment_plan is False
    assert result.id == "pr-1"
    assert result.checkout_url == "https://pay/x"


def test_create_payment_max_installments_none_hits_payment_requests(
    monkeypatch,
) -> None:
    captured = _install_capture(
        monkeypatch,
        {"id": "pr-2", "status": "pending", "checkout_v2_url": "https://pay/x"},
    )
    client = SimpleFIClient("fake-key")

    client.create_payment(
        amount=Decimal("100.00"),
        popup_slug="popup",
        tenant_slug="tenant",
        max_installments=None,
    )

    assert captured["endpoint"] == "/payment_requests"


def test_create_payment_max_installments_one_still_one_shot(monkeypatch) -> None:
    """max_installments=1 is a degenerate "no installments" — must not call
    /installment_plans because SimpleFi rejects max_installments < 2."""
    captured = _install_capture(
        monkeypatch,
        {"id": "pr-3", "status": "pending", "checkout_v2_url": "https://pay/x"},
    )
    client = SimpleFIClient("fake-key")

    client.create_payment(
        amount=Decimal("100.00"),
        popup_slug="popup",
        tenant_slug="tenant",
        max_installments=1,
    )

    assert captured["endpoint"] == "/payment_requests"


def test_create_payment_installment_branch_hits_installment_plans(
    monkeypatch,
) -> None:
    captured = _install_capture(
        monkeypatch,
        {
            "id": "plan-1",
            "status": "pending",
            "checkout_url": "https://pay/plan/plan-1",
        },
    )
    client = SimpleFIClient("fake-key")

    result = client.create_payment(
        amount=Decimal("600.00"),
        popup_slug="popup",
        tenant_slug="tenant",
        currency="USD",
        max_installments=6,
        installment_interval="month",
        installment_interval_count=1,
        user_email="buyer@example.com",
        plan_name="My Popup",
        reference={"application_id": "abc"},
    )

    assert captured["endpoint"] == "/installment_plans"
    body = captured["body"]
    assert body["total_amount"] == 600.0
    assert body["max_installments"] == 6
    # We must NOT send number_of_installments — that would activate the plan
    # immediately and skip the buyer-side picker.
    assert "number_of_installments" not in body
    assert body["interval"] == "month"
    assert body["interval_count"] == 1
    assert body["user_email"] == "buyer@example.com"
    assert body["name"] == "My Popup"
    assert body["currency"] == "USD"
    assert body["reference"] == {"application_id": "abc"}
    assert "notification_url" in body
    assert "redirect_urls" in body
    assert body["redirect_urls"]["success_behavior"] == "manual"

    assert isinstance(result, SimpleFIPaymentResponse)
    assert result.is_installment_plan is True
    assert result.id == "plan-1"
    assert result.checkout_url == "https://pay/plan/plan-1"


def test_create_payment_installment_branch_requires_user_email(monkeypatch) -> None:
    # Should fail before any HTTP call, so install a stub that raises on call.
    def fail(*_args, **_kwargs):  # pragma: no cover
        raise AssertionError("HTTP should not be called when validation fails")

    monkeypatch.setattr(SimpleFIClient, "_make_request", fail)
    client = SimpleFIClient("fake-key")

    with pytest.raises(ValueError, match="user_email"):
        client.create_payment(
            amount=Decimal("600.00"),
            popup_slug="popup",
            tenant_slug="tenant",
            max_installments=6,
            user_email=None,
        )


def test_create_payment_installment_branch_omits_name_when_not_provided(
    monkeypatch,
) -> None:
    captured = _install_capture(
        monkeypatch,
        {
            "id": "plan-2",
            "status": "pending",
            "checkout_url": "https://pay/plan/plan-2",
        },
    )
    client = SimpleFIClient("fake-key")

    client.create_payment(
        amount=Decimal("600.00"),
        popup_slug="popup",
        tenant_slug="tenant",
        max_installments=3,
        user_email="buyer@example.com",
    )

    assert "name" not in captured["body"]


def test_create_payment_passes_through_custom_interval(monkeypatch) -> None:
    captured = _install_capture(
        monkeypatch,
        {
            "id": "plan-3",
            "status": "pending",
            "checkout_url": "https://pay/plan/plan-3",
        },
    )
    client = SimpleFIClient("fake-key")

    client.create_payment(
        amount=Decimal("420.00"),
        popup_slug="popup",
        tenant_slug="tenant",
        max_installments=4,
        installment_interval="week",
        installment_interval_count=2,
        user_email="buyer@example.com",
    )

    body = captured["body"]
    assert body["interval"] == "week"
    assert body["interval_count"] == 2


def test_create_payment_passes_through_automatic_success_behavior(
    monkeypatch,
) -> None:
    captured = _install_capture(
        monkeypatch,
        {"id": "pr-4", "status": "pending", "checkout_v2_url": "https://pay/x"},
    )
    client = SimpleFIClient("fake-key")

    client.create_payment(
        amount=Decimal("100.00"),
        popup_slug="popup",
        tenant_slug="tenant",
        success_behavior="automatic",
    )

    assert captured["body"]["redirect_urls"]["success_behavior"] == "automatic"


def test_create_payment_installment_branch_passes_success_behavior(
    monkeypatch,
) -> None:
    captured = _install_capture(
        monkeypatch,
        {
            "id": "plan-4",
            "status": "pending",
            "checkout_url": "https://pay/plan/plan-4",
        },
    )
    client = SimpleFIClient("fake-key")

    client.create_payment(
        amount=Decimal("600.00"),
        popup_slug="popup",
        tenant_slug="tenant",
        max_installments=3,
        user_email="buyer@example.com",
        success_behavior="automatic",
    )

    assert captured["body"]["redirect_urls"]["success_behavior"] == "automatic"
