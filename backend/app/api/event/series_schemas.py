"""Read-only backoffice projections of an event series."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.api.event.schemas import EventStatus
from app.api.event_participant.schemas import EventParticipantPublic


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


class EventSeriesUnscheduledRsvps(BaseModel):
    event_id: uuid.UUID
    occurrence_start: datetime | None
    title: str
    timezone: str
    attendee_count: int
    participants: list[EventParticipantPublic]


class EventSeriesSummary(BaseModel):
    series_id: uuid.UUID
    series_title: str
    timezone: str
    window_start: datetime
    window_end: datetime
    occurrences: list[EventSeriesOccurrence]
    outside_schedule: list[EventSeriesUnscheduledRsvps]
