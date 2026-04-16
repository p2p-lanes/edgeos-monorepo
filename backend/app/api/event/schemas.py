import uuid
from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, DateTime, Field, SQLModel


class EventStatus(str, Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    CANCELLED = "cancelled"
    # The event was created against a venue that requires admin approval and
    # is waiting for a decision. While pending the event stays unlisted and
    # cannot be published until an admin approves the request.
    PENDING_APPROVAL = "pending_approval"
    # Admin rejected the event request. Kept for audit instead of deleting.
    REJECTED = "rejected"


class EventVisibility(str, Enum):
    PUBLIC = "public"
    PRIVATE = "private"
    UNLISTED = "unlisted"


# ---------------------------------------------------------------------------
# Recurrence (RRULE subset)
# ---------------------------------------------------------------------------


RecurrenceFreq = Literal["DAILY", "WEEKLY", "MONTHLY"]
RecurrenceWeekday = Literal["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


class RecurrenceRule(BaseModel):
    """UI-friendly representation of the subset of RFC-5545 we support.

    Converted to/from a canonical RRULE string via
    ``app.api.event.recurrence.format_rrule``/``parse_rrule``.
    """

    freq: RecurrenceFreq
    interval: int = Field(default=1, ge=1, le=999)
    by_day: list[RecurrenceWeekday] | None = None
    count: int | None = Field(default=None, ge=1, le=1000)
    until: datetime | None = None

    @model_validator(mode="after")
    def _validate_terminator(self) -> "RecurrenceRule":
        if self.count is not None and self.until is not None:
            raise ValueError("Use exactly one of COUNT or UNTIL, not both")
        if self.by_day and self.freq != "WEEKLY":
            raise ValueError("BYDAY is only allowed when FREQ=WEEKLY")
        return self


class EventBase(SQLModel):
    """Base event schema with fields shared across all event schemas."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    owner_id: uuid.UUID = Field(index=True)
    title: str = Field(max_length=255)
    content: str | None = Field(default=None, sa_type=Text())
    start_time: datetime = Field(sa_type=DateTime(timezone=True))
    end_time: datetime = Field(sa_type=DateTime(timezone=True))
    timezone: str = Field(default="UTC", max_length=64)
    cover_url: str | None = Field(default=None, sa_type=Text())
    meeting_url: str | None = Field(default=None, sa_type=Text())
    max_participant: int | None = Field(default=None)
    tags: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="[]"),
    )
    venue_id: uuid.UUID | None = Field(default=None, foreign_key="event_venues.id")
    track_id: uuid.UUID | None = Field(
        default=None, foreign_key="tracks.id", index=True
    )
    visibility: EventVisibility = Field(
        default=EventVisibility.PUBLIC, max_length=20
    )
    require_approval: bool = Field(default=False)
    kind: str | None = Field(default=None, max_length=100)
    status: EventStatus = Field(default=EventStatus.DRAFT)
    # --- Recurrence ------------------------------------------------------
    # Canonical RRULE string (RFC-5545 subset). NULL for one-off events.
    rrule: str | None = Field(default=None, sa_type=Text())
    # If set, this row is a materialized override of another series master.
    recurrence_master_id: uuid.UUID | None = Field(
        default=None, foreign_key="events.id"
    )
    # ISO8601 datetimes (UTC) to skip when expanding the series.
    recurrence_exdates: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="[]"),
    )
    # iTIP SEQUENCE (RFC 5546). Bumps on material changes (title, start, end,
    # venue, cancel) so updated invitation emails replace the prior calendar
    # entry in Gmail / Apple Calendar / Outlook instead of creating a new one.
    ical_sequence: int = Field(default=0, ge=0)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_type=DateTime(timezone=True),
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_type=DateTime(timezone=True),
    )


class EventPublic(EventBase):
    """Event schema for API responses."""

    id: uuid.UUID
    # Virtual field populated when an instance is expanded from a series
    # master. Format: ``{master_id}_{yyyymmddTHHMMSS}``. ``None`` for real
    # (persisted) rows.
    occurrence_id: str | None = None

    model_config = ConfigDict(from_attributes=True)


class EventCreate(BaseModel):
    """Event schema for creation."""

    popup_id: uuid.UUID
    title: str
    content: str | None = None
    start_time: datetime
    end_time: datetime
    timezone: str = "UTC"
    cover_url: str | None = None
    meeting_url: str | None = None
    max_participant: int | None = None
    tags: list[str] = []
    venue_id: uuid.UUID | None = None
    track_id: uuid.UUID | None = None
    visibility: EventVisibility = EventVisibility.PUBLIC
    require_approval: bool = False
    kind: str | None = None
    status: EventStatus = EventStatus.DRAFT
    recurrence: RecurrenceRule | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class EventUpdate(BaseModel):
    """Event schema for updates."""

    title: str | None = None
    content: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    timezone: str | None = None
    cover_url: str | None = None
    meeting_url: str | None = None
    max_participant: int | None = None
    tags: list[str] | None = None
    venue_id: uuid.UUID | None = None
    track_id: uuid.UUID | None = None
    visibility: EventVisibility | None = None
    require_approval: bool | None = None
    kind: str | None = None
    status: EventStatus | None = None


class RecurrenceUpdate(BaseModel):
    """Body for PATCH /events/{id}/recurrence.

    ``recurrence=None`` clears the RRULE (series becomes a one-off).
    """

    recurrence: RecurrenceRule | None = None


class OccurrenceRef(BaseModel):
    """Body referencing a specific instance of a recurring series."""

    occurrence_start: datetime


# ---------------------------------------------------------------------------
# Invitations (bulk paste by email for private/unlisted events)
# ---------------------------------------------------------------------------


class EventInvitationPublic(BaseModel):
    id: uuid.UUID
    event_id: uuid.UUID
    human_id: uuid.UUID
    email: str
    first_name: str | None = None
    last_name: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventInvitationBulkCreate(BaseModel):
    """Paste-a-list bulk invite. Emails must match humans in the tenant."""

    emails: list[str] = Field(min_length=1, max_length=1000)


class EventInvitationBulkResult(BaseModel):
    invited: list[EventInvitationPublic]
    skipped_existing: list[str]
    not_found: list[str]


# ---------------------------------------------------------------------------
# Venue availability check (used by the event form)
# ---------------------------------------------------------------------------


class EventAvailabilityCheck(BaseModel):
    venue_id: uuid.UUID
    start_time: datetime
    end_time: datetime
    exclude_event_id: uuid.UUID | None = None


class EventAvailabilityResult(BaseModel):
    available: bool
    conflicts: list[uuid.UUID] = []
    reason: str | None = None
