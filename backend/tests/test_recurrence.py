"""Tests for the pure recurrence module (app.api.event.recurrence).

Covers:
- Daily / weekly / monthly expansion
- COUNT vs UNTIL terminators (and the mutual-exclusion validator)
- EXDATE skipping
- Canonical RRULE round-trip
- Synthetic occurrence id packing/unpacking
"""

from datetime import datetime

import pytest

from app.api.event.recurrence import (
    expand,
    format_rrule,
    parse_occurrence_id,
    parse_rrule,
    synthetic_occurrence_id,
)
from app.api.event.schemas import RecurrenceRule


def test_daily_count_expansion() -> None:
    rule = RecurrenceRule(freq="DAILY", interval=1, count=5)
    start = datetime(2026, 4, 14, 9, 0, 0)
    out = expand(dtstart=start, rule=rule)
    assert [dt.day for dt in out] == [14, 15, 16, 17, 18]
    assert all(dt.hour == 9 for dt in out)


def test_weekly_byday_until() -> None:
    # Tue Apr 14 2026; advance by 1 week, emit every TU/TH until a cap.
    rule = RecurrenceRule(
        freq="WEEKLY",
        interval=1,
        by_day=["TU", "TH"],
        until=datetime(2026, 4, 28, 23, 59, 59),
    )
    start = datetime(2026, 4, 14, 18, 0, 0)
    out = expand(dtstart=start, rule=rule)
    # Tue 14, Thu 16, Tue 21, Thu 23, Tue 28
    assert [dt.strftime("%Y-%m-%d") for dt in out] == [
        "2026-04-14",
        "2026-04-16",
        "2026-04-21",
        "2026-04-23",
        "2026-04-28",
    ]


def test_monthly_same_day_and_clamp() -> None:
    # Jan 31 -> Feb 28 (clamped) -> Mar 31 -> Apr 30 (clamped)
    rule = RecurrenceRule(freq="MONTHLY", interval=1, count=4)
    start = datetime(2026, 1, 31, 12, 0, 0)
    out = expand(dtstart=start, rule=rule)
    assert [dt.strftime("%Y-%m-%d") for dt in out] == [
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
    ]


def test_exdate_skips_instance() -> None:
    rule = RecurrenceRule(freq="DAILY", count=5)
    start = datetime(2026, 4, 14, 9, 0, 0)
    exdates = [datetime(2026, 4, 16, 9, 0, 0).isoformat()]
    out = expand(dtstart=start, rule=rule, exdates=exdates)
    # COUNT is RFC-semantic: EXDATE entries still consume the counter, so we
    # get 4 results (the 5th slot was skipped).
    assert [dt.strftime("%Y-%m-%d") for dt in out] == [
        "2026-04-14",
        "2026-04-15",
        "2026-04-17",
        "2026-04-18",
    ]


def test_count_and_until_mutually_exclusive() -> None:
    with pytest.raises(ValueError):
        RecurrenceRule(freq="DAILY", count=3, until=datetime(2026, 4, 20))


def test_byday_requires_weekly() -> None:
    with pytest.raises(ValueError):
        RecurrenceRule(freq="DAILY", by_day=["MO"])


def test_rrule_roundtrip_count() -> None:
    rule = RecurrenceRule(freq="WEEKLY", interval=2, by_day=["TU", "TH"], count=10)
    s = format_rrule(rule)
    assert s == "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=10"
    roundtrip = parse_rrule(s)
    assert roundtrip is not None
    assert roundtrip.freq == "WEEKLY"
    assert roundtrip.interval == 2
    assert roundtrip.by_day == ["TU", "TH"]
    assert roundtrip.count == 10
    assert roundtrip.until is None


def test_rrule_roundtrip_until() -> None:
    rule = RecurrenceRule(freq="DAILY", interval=1, until=datetime(2026, 8, 1))
    s = format_rrule(rule)
    assert s == "FREQ=DAILY;INTERVAL=1;UNTIL=20260801T000000Z"
    roundtrip = parse_rrule(s)
    assert roundtrip is not None
    assert roundtrip.until == datetime(2026, 8, 1)


def test_parse_rrule_rejects_both_terminators() -> None:
    with pytest.raises(ValueError):
        parse_rrule("FREQ=DAILY;COUNT=3;UNTIL=20260801T000000Z")


def test_parse_rrule_none_on_empty() -> None:
    assert parse_rrule(None) is None
    assert parse_rrule("") is None


def test_window_filter() -> None:
    rule = RecurrenceRule(freq="DAILY", count=10)
    start = datetime(2026, 4, 14, 0, 0, 0)
    out = expand(
        dtstart=start,
        rule=rule,
        window_start=datetime(2026, 4, 16),
        window_end=datetime(2026, 4, 18),
    )
    assert [dt.day for dt in out] == [16, 17, 18]


def test_window_past_dtstart_daily_unbounded() -> None:
    # Regression: for an unbounded daily series whose dtstart precedes the
    # window by more than ``DEFAULT_MAX_OCCURRENCES`` days, the expander used
    # to return [] because pre-window candidates exhausted the safety cap.
    rule = RecurrenceRule(freq="DAILY", interval=1)
    dtstart = datetime(2026, 1, 1, 9, 0, 0)
    window_start = datetime(2026, 5, 1, 0, 0, 0)  # +120 days
    window_end = datetime(2026, 5, 31, 23, 59, 59)
    out = expand(
        dtstart=dtstart,
        rule=rule,
        window_start=window_start,
        window_end=window_end,
    )
    # 31 May occurrences should all be emitted.
    assert len(out) == 31
    assert out[0].strftime("%Y-%m-%d") == "2026-05-01"
    assert out[-1].strftime("%Y-%m-%d") == "2026-05-31"
    assert all(dt.hour == 9 for dt in out)


def test_window_past_dtstart_weekly_byday() -> None:
    # Weekly MO/WE series starting 6 months before the window; the window
    # should still see every MO/WE inside it.
    rule = RecurrenceRule(freq="WEEKLY", interval=1, by_day=["MO", "WE"])
    dtstart = datetime(2025, 11, 3, 10, 0, 0)  # Mon Nov 3 2025
    window_start = datetime(2026, 5, 1, 0, 0, 0)
    window_end = datetime(2026, 5, 15, 23, 59, 59)
    out = expand(
        dtstart=dtstart,
        rule=rule,
        window_start=window_start,
        window_end=window_end,
    )
    dates = [dt.strftime("%Y-%m-%d") for dt in out]
    assert dates == [
        "2026-05-04",  # Mon
        "2026-05-06",  # Wed
        "2026-05-11",  # Mon
        "2026-05-13",  # Wed
    ]


def test_occurrence_id_roundtrip() -> None:
    master_id = "11111111-1111-1111-1111-111111111111"
    dt = datetime(2026, 4, 14, 18, 30, 0)
    sid = synthetic_occurrence_id(master_id, dt)
    parsed = parse_occurrence_id(sid)
    assert parsed is not None
    mid, decoded = parsed
    assert mid == master_id
    assert decoded == dt
