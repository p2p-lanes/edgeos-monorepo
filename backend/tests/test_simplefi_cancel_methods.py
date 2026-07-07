"""Tests for SimpleFi client cancel/status methods (pending-payment-hold-release PR 1).

Covers:
- CancelOutcome enum (task 1.1)
- _normalize_cancel_status — both 'canceled' (one-L) and 'cancelled' (two-L),
  approved/active/completed, and still-pending (task 1.1)
- _non_retrying_request — bypasses retry loop and returns raw httpx.Response (task 1.2)
- cancel_payment_request — outcome classification + 4xx fallback + transport propagation (task 1.3)
- cancel_installment_plan — 'cancelled' two-L + active/completed semantics (task 1.4)
- get_installment_plan_status — status-only GET (task 1.4)
- CancelOutcomeAmbiguousError — raised for pending/missing/unknown status (review fixes)
- Single-attempt fallback bound — 4xx re-read uses _non_retrying_request, not _make_request
"""

from types import SimpleNamespace

import httpx
import pytest

from app.services.simplefi.client import (
    CancelOutcome,
    CancelOutcomeAmbiguousError,
    SimpleFIClient,
    SimpleFIPaymentRequestStatus,
    _normalize_cancel_status,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeResponse:
    """Minimal stand-in for httpx.Response used in cancel-method unit tests."""

    def __init__(self, status_code: int, json_data: dict) -> None:
        self.status_code = status_code
        self._json_data = json_data

    def json(self) -> dict:
        return self._json_data

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=httpx.Request(
                    "PUT", "https://apidev.simplefi.tech/payment_requests/x/cancel"
                ),
                response=httpx.Response(self.status_code),
            )


def _stub_non_retrying(monkeypatch, response: _FakeResponse) -> dict:
    """Patch SimpleFIClient._non_retrying_request and capture call arguments."""
    captured: dict = {}

    def fake(_self, method: str, endpoint: str) -> _FakeResponse:
        captured["method"] = method
        captured["endpoint"] = endpoint
        return response

    monkeypatch.setattr(SimpleFIClient, "_non_retrying_request", fake)
    return captured


def _stub_non_retrying_sequence(monkeypatch, responses: list) -> None:
    """Stub _non_retrying_request to yield items from responses in sequence.

    Each list item is either a _FakeResponse (returned) or an Exception
    instance (raised). Useful when a single test triggers multiple calls to
    _non_retrying_request — e.g. the cancel PUT followed by the fallback
    status GET.
    """
    call_count = [0]

    def fake(_self, _method: str, _endpoint: str) -> _FakeResponse:
        idx = call_count[0]
        call_count[0] += 1
        item = responses[idx]
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(SimpleFIClient, "_non_retrying_request", fake)


def _stub_make_request(monkeypatch, return_value: dict) -> None:
    """Patch SimpleFIClient._make_request (retrying, used by public status getters)."""

    def fake(_self, _method: str, _endpoint: str, _json=None) -> dict:
        return return_value

    monkeypatch.setattr(SimpleFIClient, "_make_request", fake)


# ---------------------------------------------------------------------------
# Task 1.1 — CancelOutcome enum (value-pinned assertions)
# ---------------------------------------------------------------------------


def test_cancel_outcome_canceled_value_is_string_canceled() -> None:
    assert CancelOutcome.CANCELED == "canceled"


def test_cancel_outcome_already_approved_value_is_string_already_approved() -> None:
    assert CancelOutcome.ALREADY_APPROVED == "already_approved"


def test_cancel_outcome_canceled_and_already_approved_are_distinct() -> None:
    assert CancelOutcome.CANCELED != CancelOutcome.ALREADY_APPROVED


# ---------------------------------------------------------------------------
# Task 1.1 — _normalize_cancel_status
# ---------------------------------------------------------------------------


def test_normalize_canceled_one_l() -> None:
    assert _normalize_cancel_status("canceled") == "canceled"


def test_normalize_cancelled_two_l() -> None:
    # SimpleFi installment_plans use the two-L spelling
    assert _normalize_cancel_status("cancelled") == "cancelled"


def test_normalize_expired() -> None:
    assert _normalize_cancel_status("expired") == "expired"


def test_normalize_refunded() -> None:
    assert _normalize_cancel_status("refunded") == "refunded"


def test_normalize_approved() -> None:
    assert _normalize_cancel_status("approved") == "approved"


def test_normalize_active() -> None:
    assert _normalize_cancel_status("active") == "active"


def test_normalize_completed() -> None:
    assert _normalize_cancel_status("completed") == "completed"


def test_normalize_pending() -> None:
    assert _normalize_cancel_status("pending") == "pending"


def test_normalize_strips_whitespace() -> None:
    assert _normalize_cancel_status("  Canceled  ") == "canceled"


def test_normalize_is_case_insensitive() -> None:
    assert _normalize_cancel_status("CANCELLED") == "cancelled"


# ---------------------------------------------------------------------------
# Task 1.2 — _non_retrying_request bypasses retry loop
# ---------------------------------------------------------------------------


def test_non_retrying_request_does_not_call_make_request(monkeypatch) -> None:
    """_non_retrying_request must never delegate to the retrying _make_request."""

    def forbidden_make_request(_self, *_args, **_kwargs):  # pragma: no cover
        raise AssertionError(
            "_make_request must not be called from _non_retrying_request"
        )

    monkeypatch.setattr(SimpleFIClient, "_make_request", forbidden_make_request)

    captured_calls: list[dict] = []

    def fake_httpx_request(_self, method, url, **_kwargs):
        captured_calls.append({"method": method, "url": url})
        return SimpleNamespace(
            status_code=200,
            text="{}",
            json=lambda: {"id": "x", "status": "canceled"},
            raise_for_status=lambda: None,
        )

    monkeypatch.setattr(httpx.Client, "request", fake_httpx_request)

    client = SimpleFIClient("fake-key")
    client._non_retrying_request("DELETE", "/payment_requests/test-id")

    assert len(captured_calls) == 1, "exactly one HTTP call, no retry"
    assert captured_calls[0]["method"] == "DELETE"
    assert "/payment_requests/test-id" in captured_calls[0]["url"]


def test_non_retrying_request_transport_error_propagates_immediately(
    monkeypatch,
) -> None:
    """Transport errors must not be caught or retried — they propagate directly."""
    call_count = [0]

    def fake_httpx_request(_self, _method, _url, **_kwargs):
        call_count[0] += 1
        raise httpx.ConnectError("Network failure")

    monkeypatch.setattr(httpx.Client, "request", fake_httpx_request)

    client = SimpleFIClient("fake-key")
    with pytest.raises(httpx.ConnectError):
        client._non_retrying_request("DELETE", "/payment_requests/test-id")

    assert call_count[0] == 1, "no retry: called exactly once"


# ---------------------------------------------------------------------------
# Task 1.3 — cancel_payment_request: happy path
# ---------------------------------------------------------------------------


def test_cancel_payment_request_2xx_canceled_status_returns_canceled(
    monkeypatch,
) -> None:
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "pr-1", "status": "canceled"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_payment_request("pr-1") == CancelOutcome.CANCELED


def test_cancel_payment_request_2xx_cancelled_two_l_returns_canceled(
    monkeypatch,
) -> None:
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "pr-1", "status": "cancelled"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_payment_request("pr-1") == CancelOutcome.CANCELED


def test_cancel_payment_request_2xx_expired_returns_canceled(monkeypatch) -> None:
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "pr-1", "status": "expired"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_payment_request("pr-1") == CancelOutcome.CANCELED


def test_cancel_payment_request_2xx_refunded_returns_canceled(monkeypatch) -> None:
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "pr-1", "status": "refunded"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_payment_request("pr-1") == CancelOutcome.CANCELED


def test_cancel_payment_request_2xx_approved_returns_already_approved(
    monkeypatch,
) -> None:
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "pr-1", "status": "approved"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_payment_request("pr-1") == CancelOutcome.ALREADY_APPROVED


def test_cancel_payment_request_2xx_active_returns_already_approved(
    monkeypatch,
) -> None:
    # 'active' appears in some SimpleFi entity types to mean money committed
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "pr-1", "status": "active"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_payment_request("pr-1") == CancelOutcome.ALREADY_APPROVED


def test_cancel_payment_request_2xx_completed_returns_already_approved(
    monkeypatch,
) -> None:
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "pr-1", "status": "completed"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_payment_request("pr-1") == CancelOutcome.ALREADY_APPROVED


# ---------------------------------------------------------------------------
# Task 1.3 — cancel_payment_request: ambiguous status (review fix)
# ---------------------------------------------------------------------------


def test_cancel_payment_request_2xx_pending_raises_ambiguous(monkeypatch) -> None:
    """2xx body with 'pending' status cannot be classified — must raise."""
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "pr-1", "status": "pending"})
    )
    client = SimpleFIClient("fake-key")
    with pytest.raises(CancelOutcomeAmbiguousError):
        client.cancel_payment_request("pr-1")


def test_cancel_payment_request_2xx_missing_status_raises_ambiguous(
    monkeypatch,
) -> None:
    """2xx body with no 'status' key is unclassifiable — must raise."""
    _stub_non_retrying(monkeypatch, _FakeResponse(200, {"id": "pr-1"}))
    client = SimpleFIClient("fake-key")
    with pytest.raises(CancelOutcomeAmbiguousError):
        client.cancel_payment_request("pr-1")


def test_cancel_payment_request_4xx_then_fallback_pending_raises_ambiguous(
    monkeypatch,
) -> None:
    """4xx cancel + single-attempt re-read returns 'pending' → must raise."""
    _stub_non_retrying_sequence(
        monkeypatch,
        [
            _FakeResponse(422, {}),
            _FakeResponse(
                200, {"payment_request": {"id": "pr-1", "status": "pending"}}
            ),
        ],
    )
    client = SimpleFIClient("fake-key")
    with pytest.raises(CancelOutcomeAmbiguousError):
        client.cancel_payment_request("pr-1")


# ---------------------------------------------------------------------------
# Task 1.3 — cancel_payment_request: 4xx fallback (single-attempt, review fix)
# ---------------------------------------------------------------------------


def test_cancel_payment_request_4xx_then_status_expired_returns_canceled(
    monkeypatch,
) -> None:
    """4xx from cancel → single-attempt re-read → expired → CANCELED."""
    _stub_non_retrying_sequence(
        monkeypatch,
        [
            _FakeResponse(422, {}),
            _FakeResponse(
                200, {"payment_request": {"id": "pr-1", "status": "expired"}}
            ),
        ],
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_payment_request("pr-1") == CancelOutcome.CANCELED


def test_cancel_payment_request_4xx_then_status_approved_returns_already_approved(
    monkeypatch,
) -> None:
    """4xx from cancel → single-attempt re-read → approved → ALREADY_APPROVED."""
    _stub_non_retrying_sequence(
        monkeypatch,
        [
            _FakeResponse(404, {}),
            _FakeResponse(
                200, {"payment_request": {"id": "pr-1", "status": "approved"}}
            ),
        ],
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_payment_request("pr-1") == CancelOutcome.ALREADY_APPROVED


def test_cancel_payment_request_4xx_then_status_cancelled_two_l_returns_canceled(
    monkeypatch,
) -> None:
    _stub_non_retrying_sequence(
        monkeypatch,
        [
            _FakeResponse(422, {}),
            _FakeResponse(
                200, {"payment_request": {"id": "pr-1", "status": "cancelled"}}
            ),
        ],
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_payment_request("pr-1") == CancelOutcome.CANCELED


# ---------------------------------------------------------------------------
# Task 1.3 — cancel_payment_request: fallback failure propagates (review fix)
# ---------------------------------------------------------------------------


def test_cancel_payment_request_4xx_then_fallback_transport_error_raises(
    monkeypatch,
) -> None:
    """4xx cancel + single-attempt re-read transport error → exception propagates."""
    _stub_non_retrying_sequence(
        monkeypatch,
        [
            _FakeResponse(422, {}),
            httpx.ConnectError("network failure"),
        ],
    )
    client = SimpleFIClient("fake-key")
    with pytest.raises(httpx.ConnectError):
        client.cancel_payment_request("pr-1")


def test_cancel_payment_request_4xx_then_fallback_5xx_raises(monkeypatch) -> None:
    """4xx cancel + single-attempt re-read returns 5xx → exception propagates."""
    _stub_non_retrying_sequence(
        monkeypatch,
        [
            _FakeResponse(422, {}),
            _FakeResponse(503, {}),
        ],
    )
    client = SimpleFIClient("fake-key")
    with pytest.raises(httpx.HTTPStatusError):
        client.cancel_payment_request("pr-1")


# ---------------------------------------------------------------------------
# Task 1.3 — cancel_payment_request: error paths
# ---------------------------------------------------------------------------


def test_cancel_payment_request_5xx_raises(monkeypatch) -> None:
    """5xx must raise — no fallback."""
    _stub_non_retrying(monkeypatch, _FakeResponse(500, {}))
    client = SimpleFIClient("fake-key")
    with pytest.raises(httpx.HTTPStatusError):
        client.cancel_payment_request("pr-1")


def test_cancel_payment_request_transport_error_raises(monkeypatch) -> None:
    """Transport / timeout errors must propagate — no retry, no fallback."""

    def fake_non_retrying(_self, _method, _endpoint):
        raise httpx.ConnectError("timeout")

    monkeypatch.setattr(SimpleFIClient, "_non_retrying_request", fake_non_retrying)
    client = SimpleFIClient("fake-key")
    with pytest.raises(httpx.ConnectError):
        client.cancel_payment_request("pr-1")


def test_cancel_payment_request_does_not_call_make_request_on_2xx(monkeypatch) -> None:
    """On 2xx the retrying _make_request must never be called."""
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "pr-1", "status": "canceled"})
    )

    def forbidden(_self, *_args, **_kwargs):  # pragma: no cover
        raise AssertionError("_make_request must not be called on 2xx cancel")

    monkeypatch.setattr(SimpleFIClient, "_make_request", forbidden)
    client = SimpleFIClient("fake-key")
    result = client.cancel_payment_request("pr-1")
    assert result == CancelOutcome.CANCELED


def test_cancel_payment_request_endpoint_path(monkeypatch) -> None:
    """Cancel must PUT to the /payment_requests/{id}/cancel endpoint."""
    captured = _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "pr-abc", "status": "canceled"})
    )
    client = SimpleFIClient("fake-key")
    client.cancel_payment_request("pr-abc")
    assert captured["method"] == "PUT"
    assert captured["endpoint"] == "/payment_requests/pr-abc/cancel"


# ---------------------------------------------------------------------------
# Task 1.4 — get_installment_plan_status
# ---------------------------------------------------------------------------


def test_get_installment_plan_status_returns_status_object(monkeypatch) -> None:
    _stub_make_request(
        monkeypatch,
        {"installment_plan": {"id": "plan-1", "status": "pending"}},
    )
    client = SimpleFIClient("fake-key")
    result = client.get_installment_plan_status("plan-1")
    assert isinstance(result, SimpleFIPaymentRequestStatus)
    assert result.id == "plan-1"
    assert result.status == "pending"


def test_get_installment_plan_status_handles_flat_payload(monkeypatch) -> None:
    """Some SimpleFi responses return a flat dict instead of a nested key."""
    _stub_make_request(monkeypatch, {"id": "plan-2", "status": "active"})
    client = SimpleFIClient("fake-key")
    result = client.get_installment_plan_status("plan-2")
    assert result.id == "plan-2"
    assert result.status == "active"


# ---------------------------------------------------------------------------
# Task 1.4 — cancel_installment_plan: happy path
# ---------------------------------------------------------------------------


def test_cancel_installment_plan_cancelled_two_l_returns_canceled(monkeypatch) -> None:
    """installment_plans use 'cancelled' (two L) — must normalize correctly."""
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "plan-1", "status": "cancelled"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_installment_plan("plan-1") == CancelOutcome.CANCELED


def test_cancel_installment_plan_canceled_one_l_also_returns_canceled(
    monkeypatch,
) -> None:
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "plan-1", "status": "canceled"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_installment_plan("plan-1") == CancelOutcome.CANCELED


def test_cancel_installment_plan_active_returns_already_approved(monkeypatch) -> None:
    """'active' on an installment_plan means money committed — race lost."""
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "plan-1", "status": "active"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_installment_plan("plan-1") == CancelOutcome.ALREADY_APPROVED


def test_cancel_installment_plan_completed_returns_already_approved(
    monkeypatch,
) -> None:
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "plan-1", "status": "completed"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_installment_plan("plan-1") == CancelOutcome.ALREADY_APPROVED


def test_cancel_installment_plan_2xx_expired_returns_canceled(monkeypatch) -> None:
    """expired is a terminal status — symmetry with cancel_payment_request."""
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "plan-1", "status": "expired"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_installment_plan("plan-1") == CancelOutcome.CANCELED


def test_cancel_installment_plan_2xx_refunded_returns_canceled(monkeypatch) -> None:
    """refunded is a terminal status — symmetry with cancel_payment_request."""
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "plan-1", "status": "refunded"})
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_installment_plan("plan-1") == CancelOutcome.CANCELED


# ---------------------------------------------------------------------------
# Task 1.4 — cancel_installment_plan: ambiguous status (review fix)
# ---------------------------------------------------------------------------


def test_cancel_installment_plan_2xx_pending_raises_ambiguous(monkeypatch) -> None:
    """2xx body with 'pending' status cannot be classified — must raise."""
    _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "plan-1", "status": "pending"})
    )
    client = SimpleFIClient("fake-key")
    with pytest.raises(CancelOutcomeAmbiguousError):
        client.cancel_installment_plan("plan-1")


def test_cancel_installment_plan_2xx_missing_status_raises_ambiguous(
    monkeypatch,
) -> None:
    """2xx body with no 'status' key is unclassifiable — must raise."""
    _stub_non_retrying(monkeypatch, _FakeResponse(200, {"id": "plan-1"}))
    client = SimpleFIClient("fake-key")
    with pytest.raises(CancelOutcomeAmbiguousError):
        client.cancel_installment_plan("plan-1")


def test_cancel_installment_plan_4xx_then_fallback_pending_raises_ambiguous(
    monkeypatch,
) -> None:
    """4xx cancel + single-attempt re-read returns 'pending' → must raise."""
    _stub_non_retrying_sequence(
        monkeypatch,
        [
            _FakeResponse(422, {}),
            _FakeResponse(
                200, {"installment_plan": {"id": "plan-1", "status": "pending"}}
            ),
        ],
    )
    client = SimpleFIClient("fake-key")
    with pytest.raises(CancelOutcomeAmbiguousError):
        client.cancel_installment_plan("plan-1")


# ---------------------------------------------------------------------------
# Task 1.4 — cancel_installment_plan: 4xx fallback (single-attempt, review fix)
# ---------------------------------------------------------------------------


def test_cancel_installment_plan_4xx_falls_back_to_status_getter(monkeypatch) -> None:
    """4xx cancel + single-attempt re-read → classified from live status."""
    _stub_non_retrying_sequence(
        monkeypatch,
        [
            _FakeResponse(422, {}),
            _FakeResponse(
                200, {"installment_plan": {"id": "plan-1", "status": "cancelled"}}
            ),
        ],
    )
    client = SimpleFIClient("fake-key")
    assert client.cancel_installment_plan("plan-1") == CancelOutcome.CANCELED


# ---------------------------------------------------------------------------
# Task 1.4 — cancel_installment_plan: fallback failure propagates (review fix)
# ---------------------------------------------------------------------------


def test_cancel_installment_plan_4xx_then_fallback_transport_error_raises(
    monkeypatch,
) -> None:
    """4xx cancel + single-attempt re-read transport error → exception propagates."""
    _stub_non_retrying_sequence(
        monkeypatch,
        [
            _FakeResponse(422, {}),
            httpx.ConnectError("network failure"),
        ],
    )
    client = SimpleFIClient("fake-key")
    with pytest.raises(httpx.ConnectError):
        client.cancel_installment_plan("plan-1")


def test_cancel_installment_plan_4xx_then_fallback_5xx_raises(monkeypatch) -> None:
    """4xx cancel + single-attempt re-read returns 5xx → exception propagates."""
    _stub_non_retrying_sequence(
        monkeypatch,
        [
            _FakeResponse(422, {}),
            _FakeResponse(503, {}),
        ],
    )
    client = SimpleFIClient("fake-key")
    with pytest.raises(httpx.HTTPStatusError):
        client.cancel_installment_plan("plan-1")


# ---------------------------------------------------------------------------
# Task 1.4 — cancel_installment_plan: error paths
# ---------------------------------------------------------------------------


def test_cancel_installment_plan_5xx_raises(monkeypatch) -> None:
    _stub_non_retrying(monkeypatch, _FakeResponse(503, {}))
    client = SimpleFIClient("fake-key")
    with pytest.raises(httpx.HTTPStatusError):
        client.cancel_installment_plan("plan-1")


def test_cancel_installment_plan_transport_error_raises(monkeypatch) -> None:
    def fake_non_retrying(_self, _method, _endpoint):
        raise httpx.TimeoutException("timed out")

    monkeypatch.setattr(SimpleFIClient, "_non_retrying_request", fake_non_retrying)
    client = SimpleFIClient("fake-key")
    with pytest.raises(httpx.TimeoutException):
        client.cancel_installment_plan("plan-1")


def test_cancel_installment_plan_endpoint_path(monkeypatch) -> None:
    """Cancel must PUT to the /installment_plans/{id}/cancel endpoint."""
    captured = _stub_non_retrying(
        monkeypatch, _FakeResponse(200, {"id": "plan-xyz", "status": "cancelled"})
    )
    client = SimpleFIClient("fake-key")
    client.cancel_installment_plan("plan-xyz")
    assert captured["method"] == "PUT"
    assert captured["endpoint"] == "/installment_plans/plan-xyz/cancel"


# ---------------------------------------------------------------------------
# Task 1.5 — global settings defaults
# ---------------------------------------------------------------------------


def test_pending_sweep_enabled_default() -> None:
    from app.core.config import settings

    assert settings.PENDING_SWEEP_ENABLED is True


def test_pending_sweep_stale_minutes_default() -> None:
    from app.core.config import settings

    assert settings.PENDING_SWEEP_STALE_MINUTES == 20


def test_pending_sweep_batch_size_default() -> None:
    from app.core.config import settings

    assert settings.PENDING_SWEEP_BATCH_SIZE == 200


def test_supersede_pending_enabled_default() -> None:
    from app.core.config import settings

    assert settings.SUPERSEDE_PENDING_ENABLED is True
