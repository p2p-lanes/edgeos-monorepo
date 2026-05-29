"""Unit tests for the timezone-aware email "when" formatter.

Event datetimes are stored as UTC instants; email bodies must show the
event's *local* wall-clock time. These cover the conversion, the day
crossing it implies, the invalid-tz fallback, and the start–end range.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.services.event_datetime import format_event_when, format_event_when_range


class TestFormatEventWhen:
    def test_converts_utc_to_la_and_crosses_day(self) -> None:
        # 01:00Z on Jun 8 is 18:00 PDT on Jun 7 (UTC-7) — the day rolls back.
        dt = datetime(2026, 6, 8, 1, 0, tzinfo=UTC)
        assert (
            format_event_when(dt, "America/Los_Angeles") == "Jun 07, 2026 at 18:00 PDT"
        )

    def test_naive_datetime_treated_as_utc(self) -> None:
        dt = datetime(2026, 6, 8, 1, 0)  # noqa: DTZ001 — intentional naive input
        assert (
            format_event_when(dt, "America/Los_Angeles") == "Jun 07, 2026 at 18:00 PDT"
        )

    def test_invalid_timezone_falls_back_to_utc(self) -> None:
        dt = datetime(2026, 6, 8, 1, 0, tzinfo=UTC)
        assert format_event_when(dt, "Not/AZone") == "Jun 08, 2026 at 01:00 UTC"

    def test_none_returns_placeholder(self) -> None:
        assert format_event_when(None, "America/Los_Angeles") == "—"


class TestFormatEventWhenRange:
    def test_same_local_day_shows_end_time_only(self) -> None:
        start = datetime(2026, 6, 8, 1, 0, tzinfo=UTC)  # 18:00 PDT Jun 7
        end = datetime(2026, 6, 8, 2, 0, tzinfo=UTC)  # 19:00 PDT Jun 7
        assert (
            format_event_when_range(start, end, "America/Los_Angeles")
            == "Jun 07, 2026 at 18:00 PDT – 19:00"
        )

    def test_multi_local_day_shows_full_end(self) -> None:
        start = datetime(2026, 6, 8, 4, 0, tzinfo=UTC)  # 21:00 PDT Jun 7
        end = datetime(2026, 6, 8, 8, 0, tzinfo=UTC)  # 01:00 PDT Jun 8
        assert format_event_when_range(start, end, "America/Los_Angeles") == (
            "Jun 07, 2026 at 21:00 PDT – Jun 08, 2026 at 01:00 PDT"
        )

    def test_missing_end_falls_back_to_start(self) -> None:
        start = datetime(2026, 6, 8, 1, 0, tzinfo=UTC)
        assert (
            format_event_when_range(start, None, "America/Los_Angeles")
            == "Jun 07, 2026 at 18:00 PDT"
        )

    def test_missing_start_returns_placeholder(self) -> None:
        end = datetime(2026, 6, 8, 1, 0, tzinfo=UTC)
        assert format_event_when_range(None, end, "America/Los_Angeles") == "—"
