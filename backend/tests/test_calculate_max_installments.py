"""Unit tests for ``_calculate_max_installments``.

The helper must match SimpleFi's calendar-month math (``relativedelta``) so
the ceiling we send actually fits before the popup's deadline. Naive
``delta.days // 30`` would silently mis-count around month boundaries.
"""

from datetime import datetime, timezone

import pytest

from app.api.payment.crud import _calculate_max_installments


JAN_15 = datetime(2026, 1, 15, tzinfo=timezone.utc)
JAN_31 = datetime(2026, 1, 31, tzinfo=timezone.utc)


def test_deadline_in_past_returns_one() -> None:
    past = datetime(2025, 12, 1, tzinfo=timezone.utc)
    assert _calculate_max_installments(past, 12, "month", 1, now=JAN_15) == 1


def test_deadline_equal_to_now_returns_one() -> None:
    assert _calculate_max_installments(JAN_15, 12, "month", 1, now=JAN_15) == 1


def test_ceiling_below_two_returns_one() -> None:
    future = datetime(2027, 1, 1, tzinfo=timezone.utc)
    assert _calculate_max_installments(future, 1, "month", 1, now=JAN_15) == 1
    assert _calculate_max_installments(future, 0, "month", 1, now=JAN_15) == 1


def test_monthly_six_months_ahead_fits_six_cycles() -> None:
    # Jan 15, Feb 15, ..., Jun 15 = 6 cycles.
    deadline = datetime(2026, 6, 15, tzinfo=timezone.utc)
    assert _calculate_max_installments(deadline, 12, "month", 1, now=JAN_15) == 6


def test_ceiling_clamps_below_calculated() -> None:
    deadline = datetime(2026, 6, 15, tzinfo=timezone.utc)
    assert _calculate_max_installments(deadline, 3, "month", 1, now=JAN_15) == 3


def test_jan_31_handles_short_february_correctly() -> None:
    """Jan 31 + 7 months = Aug 31. With deadline Aug 28, only 7 cycles fit
    (Jan 31..Jul 31) because the 8th cycle (Aug 31) is past the deadline."""
    aug28 = datetime(2026, 8, 28, tzinfo=timezone.utc)
    assert _calculate_max_installments(aug28, 12, "month", 1, now=JAN_31) == 7


def test_jan_31_deadline_aug_31_fits_exactly_eight() -> None:
    aug31 = datetime(2026, 8, 31, tzinfo=timezone.utc)
    assert _calculate_max_installments(aug31, 12, "month", 1, now=JAN_31) == 8


def test_biweekly_interval_count_two() -> None:
    # Jan 15 to Jul 15 = 26 weeks → 13 bi-weekly cycles. Clamped to 12.
    deadline = datetime(2026, 7, 15, tzinfo=timezone.utc)
    assert _calculate_max_installments(deadline, 12, "week", 2, now=JAN_15) == 12

    # 30 days ahead → ~4 bi-weeks: Jan 15, Jan 29, Feb 12. (cycle 4 = Feb 26 > deadline)
    short = datetime(2026, 2, 14, tzinfo=timezone.utc)
    assert _calculate_max_installments(short, 12, "week", 2, now=JAN_15) == 3


def test_weekly_interval() -> None:
    # Jan 15 + 4 weeks = Feb 12. Deadline Feb 12 → 5 cycles fit (15, 22, 29, 5, 12).
    deadline = datetime(2026, 2, 12, tzinfo=timezone.utc)
    assert _calculate_max_installments(deadline, 12, "week", 1, now=JAN_15) == 5


def test_daily_interval() -> None:
    # 6 days ahead → cycles Jan 15, 16, 17, 18, 19, 20, 21 = 7 cycles (cycle 1 + 6 offsets).
    deadline = datetime(2026, 1, 21, tzinfo=timezone.utc)
    assert _calculate_max_installments(deadline, 12, "day", 1, now=JAN_15) == 7


def test_yearly_interval() -> None:
    # Jan 15 2026 + 3 years = Jan 15 2029. Deadline Jan 15 2029 → 4 cycles.
    deadline = datetime(2029, 1, 15, tzinfo=timezone.utc)
    assert _calculate_max_installments(deadline, 12, "year", 1, now=JAN_15) == 4


def test_invalid_interval_raises() -> None:
    deadline = datetime(2027, 1, 1, tzinfo=timezone.utc)
    with pytest.raises(KeyError):
        _calculate_max_installments(deadline, 12, "fortnight", 1, now=JAN_15)
