"""Tests for RateLimit FastAPI dependency — CAP-G.

Scenarios:
1. First N requests pass (within limit)
2. (N+1)th request returns 429 with Retry-After header
3. 429 body is {"detail": "Too many requests", "retry_after": <N>}
4. Different IPs have independent counters
5. Redis=None causes fail-open (request proceeds, no exception)
"""

import uuid
from unittest.mock import MagicMock, patch

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.core.rate_limit import RateLimit, RateLimitExceeded

# ---------------------------------------------------------------------------
# Test app fixture
# ---------------------------------------------------------------------------


def _make_app(limit: int, window: int, prefix: str) -> FastAPI:
    """Create a minimal FastAPI app with a rate-limited endpoint."""
    app = FastAPI()

    @app.exception_handler(RateLimitExceeded)
    def handle_rate_limit(_req: Request, exc: RateLimitExceeded) -> JSONResponse:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests", "retry_after": exc.retry_after},
            headers={"Retry-After": str(exc.retry_after)},
        )

    @app.get(
        "/test",
        dependencies=[
            Depends(RateLimit(limit=limit, window_sec=window, key_prefix=prefix))
        ],
    )
    def endpoint() -> dict:
        return {"ok": True}

    return app


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_requests_within_limit_pass() -> None:
    """Requests within limit are allowed (status 200)."""
    prefix = f"test-limit-{uuid.uuid4().hex[:6]}"
    app = _make_app(limit=3, window=60, prefix=prefix)

    # Use a mock Redis that simulates fresh counter for each test
    mock_redis = MagicMock()
    counter = {"val": 0}

    def mock_get(_key: str):
        return str(counter["val"]) if counter["val"] > 0 else None

    def mock_incr(_key: str):
        counter["val"] += 1
        return counter["val"]

    def mock_setex(_key: str, _window: int, val: int):
        counter["val"] = val

    def mock_ttl(_key: str):
        return 55

    mock_redis.get = mock_get
    mock_redis.incr = mock_incr
    mock_redis.setex = mock_setex
    mock_redis.ttl = mock_ttl

    with patch("app.core.rate_limit.get_redis", return_value=mock_redis):
        client = TestClient(app, raise_server_exceptions=False)

        # First request (counter=0 → setex to 1)
        r = client.get("/test", headers={"X-Forwarded-For": "10.0.0.1"})
        assert r.status_code == 200

        # Second request (counter=1 < 3 → incr)
        r = client.get("/test", headers={"X-Forwarded-For": "10.0.0.1"})
        assert r.status_code == 200


def test_request_over_limit_returns_429() -> None:
    """Request exceeding limit returns 429 with Retry-After header."""
    prefix = f"rl-over-{uuid.uuid4().hex[:6]}"
    app = _make_app(limit=2, window=60, prefix=prefix)

    # Simulate Redis counter already at limit
    mock_redis = MagicMock()
    mock_redis.get.return_value = "2"  # already at limit
    mock_redis.ttl.return_value = 45

    with patch("app.core.rate_limit.get_redis", return_value=mock_redis):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/test", headers={"X-Forwarded-For": "10.0.0.2"})

    assert response.status_code == 429
    assert "Retry-After" in response.headers
    retry_after = int(response.headers["Retry-After"])
    assert retry_after > 0

    body = response.json()
    assert body["detail"] == "Too many requests"
    assert "retry_after" in body
    assert body["retry_after"] > 0


def test_429_body_shape() -> None:
    """429 body has exact shape: {"detail": "Too many requests", "retry_after": <N>}."""
    prefix = f"rl-shape-{uuid.uuid4().hex[:6]}"
    app = _make_app(limit=1, window=60, prefix=prefix)

    mock_redis = MagicMock()
    mock_redis.get.return_value = "5"  # over limit
    mock_redis.ttl.return_value = 30

    with patch("app.core.rate_limit.get_redis", return_value=mock_redis):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/test", headers={"X-Forwarded-For": "10.0.0.3"})

    assert response.status_code == 429
    body = response.json()
    assert set(body.keys()) >= {"detail", "retry_after"}
    assert body["detail"] == "Too many requests"
    assert isinstance(body["retry_after"], int)
    assert body["retry_after"] == 30


def test_different_ips_have_independent_counters() -> None:
    """Rate-limit counters are per-IP (different IPs don't interfere)."""
    prefix = f"rl-ip-{uuid.uuid4().hex[:6]}"
    app = _make_app(limit=2, window=60, prefix=prefix)

    # IP 1 is at the limit, IP 2 is fresh
    ip_counters: dict[str, str | None] = {}

    def mock_get(key: str) -> str | None:
        return ip_counters.get(key)

    def mock_incr(key: str) -> int:
        current = int(ip_counters.get(key) or "0")
        ip_counters[key] = str(current + 1)
        return current + 1

    def mock_setex(key: str, _window: int, val: int) -> None:
        ip_counters[key] = str(val)

    def mock_ttl(_key: str) -> int:
        return 50

    mock_redis = MagicMock()
    mock_redis.get.side_effect = mock_get
    mock_redis.incr.side_effect = mock_incr
    mock_redis.setex.side_effect = mock_setex
    mock_redis.ttl.side_effect = mock_ttl

    with patch("app.core.rate_limit.get_redis", return_value=mock_redis):
        client = TestClient(app, raise_server_exceptions=False)

        # Exhaust IP 1's quota
        ip_counters[f"{prefix}:10.0.0.10"] = "2"

        # IP 1 should be 429
        r1 = client.get("/test", headers={"X-Forwarded-For": "10.0.0.10"})
        assert r1.status_code == 429

        # IP 2 (fresh) should pass
        r2 = client.get("/test", headers={"X-Forwarded-For": "10.0.0.20"})
        assert r2.status_code == 200


def test_redis_none_fail_open() -> None:
    """When Redis is None (unavailable), request proceeds (fail-open)."""
    prefix = f"rl-failopen-{uuid.uuid4().hex[:6]}"
    app = _make_app(limit=2, window=60, prefix=prefix)

    with patch("app.core.rate_limit.get_redis", return_value=None):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/test", headers={"X-Forwarded-For": "10.0.0.99"})

    # Must NOT return 429 or 5xx due to missing Redis
    assert response.status_code == 200
    assert response.json() == {"ok": True}
