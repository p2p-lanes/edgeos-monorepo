"""Recurrence expansion must not query venue closures once per series."""

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import app.main  # noqa: F401 - register SQLModel relationships
from app.api.event.crud import _expand_rows_in_window
from app.api.event.models import Events
from app.api.event_venue.models import VenueExceptions


def test_venue_exceptions_are_loaded_once_for_multiple_series() -> None:
    tenant_id = uuid.uuid4()
    start = datetime(2031, 3, 3, 10, tzinfo=UTC)
    rows = [
        Events(
            tenant_id=tenant_id,
            popup_id=uuid.uuid4(),
            owner_id=uuid.uuid4(),
            venue_id=uuid.uuid4(),
            title=f"series-{index}",
            start_time=start + timedelta(hours=index),
            end_time=start + timedelta(hours=index + 1),
            timezone="UTC",
            rrule="FREQ=DAILY;COUNT=2",
        )
        for index in range(3)
    ]
    session = MagicMock()
    session.exec.return_value.all.return_value = []

    expanded = _expand_rows_in_window(
        session,
        rows,
        window_start=start - timedelta(days=1),
        window_end=start + timedelta(days=3),
    )

    closure_queries = [
        call
        for call in session.exec.call_args_list
        if "venue_exceptions" in str(call.args[0])
    ]
    assert len(closure_queries) == 1
    assert len(expanded) == 6


def test_batched_closures_do_not_hide_other_venues() -> None:
    tenant_id = uuid.uuid4()
    start = datetime(2031, 3, 3, 10, tzinfo=UTC)
    rows = [
        Events(
            tenant_id=tenant_id,
            popup_id=uuid.uuid4(),
            owner_id=uuid.uuid4(),
            venue_id=uuid.uuid4(),
            title=f"series-{index}",
            start_time=start,
            end_time=start + timedelta(hours=1),
            timezone="UTC",
            rrule="FREQ=DAILY;COUNT=2",
        )
        for index in range(2)
    ]
    closure = VenueExceptions(
        tenant_id=tenant_id,
        venue_id=rows[0].venue_id,
        start_datetime=start,
        end_datetime=start + timedelta(hours=1),
        is_closed=True,
    )
    session = MagicMock()
    session.exec.side_effect = [
        MagicMock(all=lambda: []),
        MagicMock(all=lambda: [closure]),
    ]

    expanded = _expand_rows_in_window(
        session,
        rows,
        window_start=start - timedelta(days=1),
        window_end=start + timedelta(days=3),
    )

    assert [event.title for event in expanded].count("series-0") == 1
    assert [event.title for event in expanded].count("series-1") == 2
