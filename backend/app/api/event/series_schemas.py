"""Read-only projections for the backoffice's participants-by-date view."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.api.event.schemas import EventStatus


class EventSeriesOccurrence(BaseModel):
    event_id: uuid.UUID
    occurrence_start: datetime | None
    start_time: datetime
    end_time: datetime
    timezone: str
    title: str
    status: EventStatus
    is_detached: bool
    attendee_count: int


class EventSeriesSummary(BaseModel):
    series_id: uuid.UUID
    series_title: str
    timezone: str
    window_start: datetime
    window_end: datetime
    occurrences: list[EventSeriesOccurrence]
