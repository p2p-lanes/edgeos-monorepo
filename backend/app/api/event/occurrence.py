"""Resolve the occurrence used by event detail reads.

A detached child owns its registrations as a one-off event. A recurring
master opened without a date represents its first occurrence, not the series.
"""

from datetime import UTC, datetime

from fastapi import HTTPException

from app.api.event_participant.check_in import is_scheduled_occurrence


def resolve_detail_occurrence(
    event, occurrence_start: datetime | None
) -> datetime | None:
    if not event.rrule:
        if occurrence_start is not None:
            raise HTTPException(
                status_code=400,
                detail="occurrence_start is not allowed for non-recurring events",
            )
        return None
    if occurrence_start is None:
        return event.start_time.astimezone(UTC)
    if occurrence_start.tzinfo is None or not is_scheduled_occurrence(
        event, occurrence_start
    ):
        raise HTTPException(
            status_code=400,
            detail="occurrence_start does not match a scheduled occurrence",
        )
    return occurrence_start.astimezone(UTC)
