"""Regression test: auth-code comparison is constant-time.

The 6-digit OTP comparison used plain ``!=``, which short-circuits on the
first differing byte and leaks (via timing) how many leading digits were
correct. Both verification paths (DB fallback in ``auth/utils.py`` and the
Redis path in ``core/redis.py``) now use ``hmac.compare_digest``.

We can't assert timing here, but we lock in that the constant-time primitive
is used and that valid/invalid/expired outcomes are unchanged.
"""

import inspect
from datetime import UTC, datetime, timedelta

from app.api.auth import utils as auth_utils
from app.api.auth.utils import is_code_valid
from app.core import redis as redis_module


def test_is_code_valid_outcomes_unchanged() -> None:
    future = datetime.now(UTC) + timedelta(minutes=5)
    past = datetime.now(UTC) - timedelta(minutes=5)

    assert is_code_valid("123456", "123456", future) == (True, None)

    ok, msg = is_code_valid("123456", "000000", future)
    assert ok is False and msg == "Invalid code"

    ok, msg = is_code_valid("123456", "123456", past)
    assert ok is False and "expired" in msg.lower()


def test_both_paths_use_constant_time_compare() -> None:
    assert "compare_digest" in inspect.getsource(auth_utils.is_code_valid)
    assert "compare_digest" in inspect.getsource(
        redis_module.AuthCodeStore._verify_code
    )
