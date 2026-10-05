"""Bounded, read-only series navigation, including dates with no RSVPs."""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import or_
from sqlmodel import Session, col, select

from app.api.event.models import Events
from app.api.event.recurrence import HARD_MAX_OCCURRENCES, expand, parse_rrule
from app.api.event.series_schemas import (
    EventSeriesOccurrence,
    EventSeriesSummary,
    EventSeriesUnscheduledRsvps,
)
from app.api.event_participant.check_in import is_scheduled_occurrence
from app.api.event_participant.crud import event_participants_crud
from app.api.event_participant.models import EventParticipants
from app.api.event_participant.presentation import participants_with_names
from app.api.event_participant.schemas import ParticipantStatus
from app.api.popup.models import Popups

MAX_WINDOW_DAYS = 366


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _gathering_window(
    master: Events, popup: Popups | None
) -> tuple[datetime, datetime]:
    if not popup or not popup.start_date or not popup.end_date:
        raise HTTPException(
            400, "Set gathering start and end dates to view other occurrences."
        )
    tz = ZoneInfo(master.timezone or "UTC")
    start = datetime.combine(popup.start_date.date(), datetime.min.time(), tz)
    end = datetime.combine(popup.end_date.date(), datetime.min.time(), tz) + timedelta(
        days=1
    )
    if end <= start:
        raise HTTPException(400, "The gathering has an invalid date range")
    return _utc(start), _utc(end)


def build_series_summary(
    db: Session,
    master: Events,
    *,
    window_start: datetime | None = None,
    window_end: datetime | None = None,
    anchor: datetime | None = None,
) -> EventSeriesSummary:
    children = list(
        db.exec(
            select(Events).where(
                Events.recurrence_master_id == master.id,
                Events.tenant_id == master.tenant_id,
                Events.popup_id == master.popup_id,
            )
        ).all()
    )
    if not master.rrule and not children:
        raise HTTPException(400, "Event is not part of a recurring series")
    if (window_start is None) != (window_end is None):
        raise HTTPException(
            400, "window_start and window_end must be supplied together"
        )
    for value in (window_start, window_end, anchor):
        if value is not None and value.tzinfo is None:
            raise HTTPException(400, "Series dates must include a timezone")
    try:
        rule = parse_rrule(master.rrule)
        ZoneInfo(master.timezone or "UTC")
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise HTTPException(
            400, "The series has an invalid schedule or timezone"
        ) from exc
    explicit_window = window_start is not None
    if not explicit_window:
        window_start, window_end = _gathering_window(
            master, db.get(Popups, master.popup_id)
        )
    assert window_start is not None and window_end is not None
    window_start, window_end = _utc(window_start), _utc(window_end)
    if explicit_window and not timedelta(0) < window_end - window_start <= timedelta(
        days=MAX_WINDOW_DAYS
    ):
        raise HTTPException(
            400, f"Series window must be positive and at most {MAX_WINDOW_DAYS} days"
        )

    family = {event.id: event for event in [master, *children]}
    counts = event_participants_crud.count_active_for_occurrences(db, list(family))
    dates = []
    if rule:
        # Always cover the full gathering, even if it exceeds the expansion
        # result cap. Each internal chunk is bounded; there is no UI paging.
        chunk_start = window_start
        while chunk_start < window_end:
            chunk_end = min(chunk_start + timedelta(days=MAX_WINDOW_DAYS), window_end)
            dates.extend(
                date
                for date in expand(
                    dtstart=master.start_time,
                    rule=rule,
                    window_start=chunk_start,
                    window_end=chunk_end,
                    exdates=master.recurrence_exdates,
                    timezone=master.timezone,
                    max_occurrences=HARD_MAX_OCCURRENCES,
                )
                if _utc(date) < chunk_end
            )
            chunk_start = chunk_end
    else:
        dates = [master.start_time]
    occurrences = [
        EventSeriesOccurrence(
            event_id=master.id,
            occurrence_start=date if rule else None,
            start_time=date,
            end_time=date + (master.end_time - master.start_time),
            timezone=master.timezone,
            title=master.title,
            status=master.status,
            is_detached=False,
            attendee_count=counts.get((master.id, date if rule else None), 0),
        )
        for date in dates
        if window_start <= _utc(date) < window_end
    ]
    occurrences.extend(
        EventSeriesOccurrence(
            event_id=child.id,
            occurrence_start=None,
            start_time=child.start_time,
            end_time=child.end_time,
            timezone=child.timezone,
            title=child.title,
            status=child.status,
            is_detached=True,
            attendee_count=counts.get((child.id, None), 0),
        )
        for child in children
        if window_start <= _utc(child.start_time) < window_end
    )
    occurrences.sort(key=lambda item: (item.start_time, str(item.event_id)))

    # A valid RSVP outside the displayed range is NOT an obsolete date.
    # Validate each distinct identity against the full schedule, not the
    # bounded expansion above. NULL on a recurring master is legacy/unscoped.
    invalid = {
        (event_id, occurrence)
        for event_id, occurrence in counts
        if (
            (
                family[event_id].rrule
                and (
                    occurrence is None
                    or not is_scheduled_occurrence(family[event_id], occurrence)
                )
            )
            or (not family[event_id].rrule and occurrence is not None)
        )
    }
    outside = []
    if invalid:
        predicates = [
            (EventParticipants.event_id == event_id)
            & (
                col(EventParticipants.occurrence_start).is_(None)
                if occurrence is None
                else EventParticipants.occurrence_start == occurrence
            )
            for event_id, occurrence in invalid
        ]
        rows = list(
            db.exec(
                select(EventParticipants).where(
                    or_(*predicates),
                    EventParticipants.status != ParticipantStatus.CANCELLED,
                )
            ).all()
        )
        # Apply the same per-event host exclusion as the counters.
        rows = [row for row in rows if row.profile_id != family[row.event_id].host_id]
        grouped = defaultdict(list)
        for participant in participants_with_names(db, rows):
            grouped[(participant.event_id, participant.occurrence_start)].append(
                participant
            )
        for (event_id, occurrence), participants in grouped.items():
            participants.sort(
                key=lambda p: (
                    (p.first_name or "").casefold(),
                    (p.last_name or "").casefold(),
                    str(p.id),
                )
            )
            outside.append(
                EventSeriesUnscheduledRsvps(
                    event_id=event_id,
                    occurrence_start=occurrence,
                    title=family[event_id].title,
                    timezone=family[event_id].timezone,
                    attendee_count=len(participants),
                    participants=participants,
                )
            )
        outside.sort(
            key=lambda item: (
                item.occurrence_start or datetime.min.replace(tzinfo=UTC),
                str(item.event_id),
            )
        )
    return EventSeriesSummary(
        series_id=master.id,
        series_title=master.title,
        timezone=master.timezone,
        window_start=window_start,
        window_end=window_end,
        occurrences=occurrences,
        outside_schedule=outside,
    )
