"""Read-only schedule and counts for participants grouped by occurrence.

This is a backoffice projection, not a change to recurrence or RSVP identity.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlmodel import Session, select

from app.api.event.models import Events
from app.api.event.recurrence import HARD_MAX_OCCURRENCES, expand, parse_rrule
from app.api.event.series_schemas import EventSeriesOccurrence, EventSeriesSummary
from app.api.event_participant.models import EventParticipants
from app.api.event_participant.schemas import ParticipantStatus
from app.api.popup.models import Popups


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def build_series_summary(db: Session, master: Events) -> EventSeriesSummary:
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
    try:
        rule = parse_rrule(master.rrule)
        tz = ZoneInfo(master.timezone or "UTC")
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise HTTPException(
            400, "The series has an invalid schedule or timezone"
        ) from exc

    popup = db.get(Popups, master.popup_id)
    if not popup or not popup.start_date or not popup.end_date:
        raise HTTPException(
            400, "Set gathering start and end dates to view other occurrences."
        )
    window_start = _utc(
        datetime.combine(popup.start_date.date(), datetime.min.time(), tz)
    )
    window_end = _utc(
        datetime.combine(popup.end_date.date(), datetime.min.time(), tz)
        + timedelta(days=1)
    )
    if window_end <= window_start:
        raise HTTPException(400, "The gathering has an invalid date range")

    # Group existing records for this view only. Keep the event list's existing
    # series-wide counts and all registration/capacity behavior unchanged.
    counts_query = (
        select(
            EventParticipants.event_id,
            EventParticipants.occurrence_start,
            func.count(),
        )
        .join(Events, Events.id == EventParticipants.event_id)
        .where(
            EventParticipants.event_id.in_(
                [master.id, *[child.id for child in children]]
            ),
            EventParticipants.status != ParticipantStatus.CANCELLED,
            or_(
                Events.host_id.is_(None), EventParticipants.profile_id != Events.host_id
            ),
        )
        .group_by(EventParticipants.event_id, EventParticipants.occurrence_start)
    )
    counts = {(row[0], row[1]): int(row[2]) for row in db.exec(counts_query).all()}

    dates = []
    if rule:
        # DAILY is the densest supported rule. Year-sized chunks stay below
        # the expansion cap and preserve zero-RSVP dates in long gatherings.
        chunk_start = window_start
        while chunk_start < window_end:
            chunk_end = min(chunk_start + timedelta(days=366), window_end)
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
    return EventSeriesSummary(
        series_id=master.id,
        series_title=master.title,
        timezone=master.timezone,
        window_start=window_start,
        window_end=window_end,
        occurrences=occurrences,
    )
