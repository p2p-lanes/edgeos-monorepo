"""Regressions found while testing the calendar end to end (2026-09).

Pure unit tests: recurrence across DST, iTIP EXDATE rendering, schema
validation, RSVP occurrence validation and the public ICS feed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.event.recurrence import expand
from app.api.event.router import _ics_vevent_lines
from app.api.event.schemas import EventCreate, EventStatus, EventUpdate, RecurrenceRule
from app.api.event_participant.router import _resolve_occurrence_start
from app.services.ical import build_event_ics

SCL = "America/Santiago"  # DST starts 2026-09-06 00:00 local
LA = "America/Los_Angeles"  # DST ends 2026-11-01 02:00 local


def _local(occurrences: list[datetime], tz: str) -> list[str]:
    return [o.astimezone(ZoneInfo(tz)).strftime("%m-%d %H:%M") for o in occurrences]


def _utc(y: int, mo: int, d: int, h: int, mi: int, tz: str) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=ZoneInfo(tz)).astimezone(UTC)


# ---------------------------------------------------------------------------
# Recurrence keeps local wall-clock across DST
# ---------------------------------------------------------------------------


def test_weekly_keeps_wall_clock_across_dst_start() -> None:
    occ = expand(
        dtstart=_utc(2026, 8, 24, 18, 0, SCL),
        rule=RecurrenceRule(freq="WEEKLY", interval=1, count=4),
        timezone=SCL,
    )
    assert _local(occ, SCL) == [
        "08-24 18:00",
        "08-31 18:00",
        "09-07 18:00",
        "09-14 18:00",
    ]


def test_weekly_byday_keeps_wall_clock_across_dst_start() -> None:
    occ = expand(
        dtstart=_utc(2026, 8, 31, 18, 0, SCL),
        rule=RecurrenceRule(freq="WEEKLY", interval=1, by_day=["MO", "WE"], count=4),
        timezone=SCL,
    )
    assert _local(occ, SCL) == [
        "08-31 18:00",
        "09-02 18:00",
        "09-07 18:00",
        "09-09 18:00",
    ]


def test_daily_keeps_wall_clock_across_dst_start() -> None:
    occ = expand(
        dtstart=_utc(2026, 9, 4, 9, 0, SCL),
        rule=RecurrenceRule(freq="DAILY", interval=1, count=5),
        timezone=SCL,
    )
    assert _local(occ, SCL) == [
        "09-04 09:00",
        "09-05 09:00",
        "09-06 09:00",
        "09-07 09:00",
        "09-08 09:00",
    ]


def test_weekly_and_monthly_keep_wall_clock_across_dst_end() -> None:
    weekly = expand(
        dtstart=_utc(2026, 10, 25, 10, 0, LA),
        rule=RecurrenceRule(freq="WEEKLY", interval=1, count=3),
        timezone=LA,
    )
    assert _local(weekly, LA) == ["10-25 10:00", "11-01 10:00", "11-08 10:00"]
    monthly = expand(
        dtstart=_utc(2026, 10, 15, 18, 0, LA),
        rule=RecurrenceRule(freq="MONTHLY", interval=1, count=2),
        timezone=LA,
    )
    assert _local(monthly, LA) == ["10-15 18:00", "11-15 18:00"]


def test_occurrence_in_dst_gap_shifts_forward() -> None:
    # 2026-09-06 00:30 does not exist in Santiago; it lands just after the gap.
    occ = expand(
        dtstart=_utc(2026, 9, 5, 0, 30, SCL),
        rule=RecurrenceRule(freq="DAILY", interval=1, count=3),
        timezone=SCL,
    )
    assert _local(occ, SCL) == ["09-05 00:30", "09-06 01:30", "09-07 00:30"]


def test_exdate_matches_post_dst_occurrence() -> None:
    occ = expand(
        dtstart=_utc(2026, 8, 24, 18, 0, SCL),
        rule=RecurrenceRule(freq="WEEKLY", interval=1, count=4),
        exdates=[_utc(2026, 9, 7, 18, 0, SCL).isoformat()],
        timezone=SCL,
    )
    assert _local(occ, SCL) == ["08-24 18:00", "08-31 18:00", "09-14 18:00"]


# ---------------------------------------------------------------------------
# iTIP body renders JSONB (string) exdates
# ---------------------------------------------------------------------------


def _series(**overrides) -> SimpleNamespace:
    data = {
        "id": uuid.uuid4(),
        "title": "Weekly sync",
        "content": "Agenda, notes",
        "start_time": _utc(2026, 8, 24, 18, 0, SCL),
        "end_time": _utc(2026, 8, 24, 19, 0, SCL),
        "timezone": SCL,
        "rrule": "FREQ=WEEKLY;INTERVAL=1;COUNT=4",
        "recurrence_exdates": ["2026-08-31T22:00:00+00:00"],
        "ical_sequence": 0,
        "meeting_url": "https://meet.example.com/secret",
        "custom_location_name": "Main hall",
        "custom_location_url": None,
        "venue": None,
        "status": EventStatus.PUBLISHED,
        "popup_id": None,
        "tenant_id": None,
        "owner_id": None,
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def test_itip_ics_renders_string_exdates() -> None:
    body = build_event_ics(_series(), recipient_email="a@example.com")
    assert "EXDATE:20260831T220000Z" in body
    assert "RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=4" in body


# ---------------------------------------------------------------------------
# Public subscription feed does not leak meeting links or content
# ---------------------------------------------------------------------------


def test_public_feed_vevent_omits_meeting_url_and_content() -> None:
    event = _series()
    public = "\r\n".join(_ics_vevent_lines(event, "20260101T000000Z", public=True))
    assert "meet.example.com" not in public
    assert "DESCRIPTION" not in public
    assert "LOCATION:Main hall" in public
    private = "\r\n".join(_ics_vevent_lines(event, "20260101T000000Z"))
    assert "LOCATION:https://meet.example.com/secret" in private


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------


def _create_payload(**overrides) -> dict:
    data = {
        "popup_id": str(uuid.uuid4()),
        "title": "x",
        "start_time": "2026-09-10T18:00:00-03:00",
        "end_time": "2026-09-10T19:00:00-03:00",
        "timezone": SCL,
    }
    data.update(overrides)
    return data


def test_create_rejects_end_before_start() -> None:
    with pytest.raises(ValidationError, match="end_time must not be before start_time"):
        EventCreate(**_create_payload(end_time="2026-09-10T17:00:00-03:00"))


def test_create_rejects_unknown_timezone() -> None:
    with pytest.raises(ValidationError, match="Unknown timezone"):
        EventCreate(**_create_payload(timezone="Not/AZone"))


def test_create_accepts_utc_default() -> None:
    payload = _create_payload()
    del payload["timezone"]
    assert EventCreate(**payload).timezone == "UTC"


def test_update_validates_timezone_and_order() -> None:
    with pytest.raises(ValidationError, match="Unknown timezone"):
        EventUpdate(timezone="Mars/Olympus_Mons")
    with pytest.raises(ValidationError, match="end_time must not be before"):
        EventUpdate(
            start_time="2026-09-10T18:00:00Z",  # type: ignore[arg-type]
            end_time="2026-09-10T17:00:00Z",  # type: ignore[arg-type]
        )
    assert EventUpdate(title="only title").timezone is None


# ---------------------------------------------------------------------------
# RSVP only targets scheduled occurrences
# ---------------------------------------------------------------------------


def test_register_rejects_unscheduled_or_removed_occurrence() -> None:
    event = _series()
    real = _utc(2026, 9, 7, 18, 0, SCL)
    assert _resolve_occurrence_start(event, real, require_scheduled=True) == real
    made_up = _utc(2026, 9, 7, 21, 17, SCL)
    removed = datetime(2026, 8, 31, 22, 0, tzinfo=UTC)
    for bad in (made_up, removed):
        with pytest.raises(HTTPException) as exc:
            _resolve_occurrence_start(event, bad, require_scheduled=True)
        assert exc.value.status_code == 400


def test_cancel_still_accepts_removed_occurrence() -> None:
    removed = datetime(2026, 8, 31, 22, 0, tzinfo=UTC)
    assert _resolve_occurrence_start(_series(), removed) == removed
