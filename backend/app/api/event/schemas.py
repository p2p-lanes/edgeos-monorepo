import uuid
from datetime import UTC, datetime
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
    # Custom location (used when no venue is selected). The pair is XOR with
    # ``venue_id`` and is validated as all-or-nothing on the create/update
    # schemas; either both fields are set or both must be null.
    custom_location_name: str | None = Field(default=None, max_length=255)
    custom_location_url: str | None = Field(default=None, sa_type=Text())
    track_id: uuid.UUID | None = Field(
        default=None, foreign_key="tracks.id", index=True
    )
    visibility: EventVisibility = Field(default=EventVisibility.PUBLIC, max_length=20)
    require_approval: bool = Field(default=False)
    kind: str | None = Field(default=None, max_length=100)
    # Optional display name shown to participants on the portal event detail
    # page. When NULL the portal falls back to the tenant's name. Free text;
    # event creators choose any of: tenant name, their own name, a participant's
    # name, or a custom value — all stored as plain text.
    host_display_name: str | None = Field(default=None, max_length=255)
    status: EventStatus = Field(default=EventStatus.DRAFT)
    # When true, portal clients render the event with a "special" treatment
    # (badge, accent border) so it stands out in the list/day/calendar views.
    highlighted: bool = Field(
        default=False, sa_column_kwargs={"server_default": "false"}
    )
    # Admin-provided reason captured when an event is rejected. Persisted so
    # the owner can see why their request was denied in the portal.
    rejection_reason: str | None = Field(default=None, sa_type=Text())
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
    # Groups-rework: links a PRIVATE event to a group for group-scoped access.
    # Semantics: visibility=PRIVATE AND group_id IS NOT NULL → group-scoped PRIVATE.
    # visibility=PRIVATE AND group_id IS NULL → invitation-based PRIVATE (existing behavior).
    group_id: uuid.UUID | None = Field(
        default=None, foreign_key="groups.id", nullable=True
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
    )


def _enforce_custom_location_xor(
    *,
    venue_id: uuid.UUID | None,
    name: str | None,
    url: str | None,
) -> None:
    """Validator helper for ``EventCreate``/``EventUpdate``.

    Rules (all-or-nothing pairing, mutually exclusive with ``venue_id``):
      - If either custom field is set, both must be set.
      - If a venue is set, neither custom field may be set.
    A venue-less, location-less event is allowed (online-only).
    """
    has_name = bool(name and name.strip())
    has_url = bool(url and url.strip())
    if has_name != has_url:
        raise ValueError(
            "custom_location_name and custom_location_url must both be "
            "provided together, or both omitted."
        )
    if venue_id is not None and (has_name or has_url):
        raise ValueError("venue_id and custom_location_* are mutually exclusive.")


class EventPublic(EventBase):
    """Event schema for API responses."""

    id: uuid.UUID
    # Virtual field populated when an instance is expanded from a series
    # master. Format: ``{master_id}_{yyyymmddTHHMMSS}``. ``None`` for real
    # (persisted) rows.
    occurrence_id: str | None = None
    # Denormalized venue fields so portal clients can render a card without
    # a follow-up call to /event-venues/{id} (that endpoint requires user
    # auth the portal doesn't have). Populated by list/get helpers; None
    # when the event has no venue.
    venue_title: str | None = None
    venue_location: str | None = None
    venue_image_url: str | None = None
    # Denormalized track name so portal clients can render the track label
    # without a follow-up call. None when the event has no track.
    track_title: str | None = None
    # True when the current human has hidden this event (per-user marker).
    # Only populated by portal endpoints and only ever True inside responses
    # to ``?include_hidden=true`` — otherwise hidden events are filtered out.
    hidden: bool = False
    # RSVP status of the current human for this event, populated by portal
    # list/get helpers. None means "not registered"; "registered" /
    # "checked_in" / "cancelled" mirror ParticipantStatus.
    my_rsvp_status: str | None = None

    model_config = ConfigDict(from_attributes=True)


class EventOpaque(BaseModel):
    """Opaque event projection for non-privileged viewers on availability endpoints.

    Contains ONLY the fields needed to communicate a booking conflict without
    leaking any event metadata. Used as the non-full-detail branch of the
    ``EventPublic | EventOpaque`` discriminated union.

    Fields MUST match the design's Decision 1d contract:
      id, start_time, end_time, venue_id, is_opaque: Literal[True]
    """

    id: uuid.UUID
    start_time: datetime
    end_time: datetime
    venue_id: uuid.UUID | None = None
    is_opaque: Literal[True] = True

    model_config = ConfigDict(from_attributes=True)


class EventHostOption(BaseModel):
    """A distinct event host for the backoffice "filter events by creator" picker.

    Resolved from ``Events.owner_id`` joined to ``Humans``. ``name`` is the
    human's full name when set, otherwise null (the UI falls back to email).
    """

    id: uuid.UUID
    name: str | None = None
    email: str


class EventAdminNotes(BaseModel):
    """Staff-only free-text notes for an event.

    Returned/accepted exclusively by the dedicated admin-notes endpoints — kept
    out of EventBase/EventPublic so it never leaks into event payloads served to
    portal humans or the public calendar.
    """

    notes: str | None = None


class EventPublicCalendarItem(BaseModel):
    """Minimal, read-only event projection for the public calendar.

    Excludes fields that are either sensitive (``meeting_url``,
    ``tenant_id``, ``owner_id``, ``rejection_reason``) or only meaningful
    to authenticated humans (``hidden``, ``my_rsvp_status``,
    ``visibility``, ``require_approval``, ``ical_sequence``, ``content``).
    """

    id: uuid.UUID
    title: str
    start_time: datetime
    end_time: datetime
    timezone: str
    kind: str | None = None
    cover_url: str | None = None
    max_participant: int | None = None
    tags: list[str] = []
    highlighted: bool = False
    host_display_name: str | None = None
    rrule: str | None = None
    recurrence_master_id: uuid.UUID | None = None
    occurrence_id: str | None = None
    venue_id: uuid.UUID | None = None
    venue_title: str | None = None
    venue_location: str | None = None
    venue_image_url: str | None = None
    custom_location_name: str | None = None
    track_id: uuid.UUID | None = None
    track_title: str | None = None

    model_config = ConfigDict(from_attributes=True)


class EventCalendarTrack(BaseModel):
    """Minimal track projection for the public calendar toolbar."""

    id: uuid.UUID
    name: str

    model_config = ConfigDict(from_attributes=True)


class EventCalendarMeta(BaseModel):
    """Toolbar/filter metadata bundled with the public calendar list."""

    allowed_tags: list[str] = []
    allowed_tracks: list[EventCalendarTrack] = []
    timezone: str = "UTC"
    popup_id: uuid.UUID
    popup_slug: str
    popup_name: str


class EventPublicCalendarResponse(BaseModel):
    """Wrapper response for ``GET /events/public/calendar``."""

    results: list[EventPublicCalendarItem]
    meta: EventCalendarMeta


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
    custom_location_name: str | None = None
    custom_location_url: str | None = None
    track_id: uuid.UUID | None = None
    visibility: EventVisibility = EventVisibility.PUBLIC
    require_approval: bool = False
    kind: str | None = None
    host_display_name: str | None = None
    status: EventStatus = EventStatus.DRAFT
    highlighted: bool = False
    recurrence: RecurrenceRule | None = None

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def _validate_custom_location(self) -> "EventCreate":
        _enforce_custom_location_xor(
            venue_id=self.venue_id,
            name=self.custom_location_name,
            url=self.custom_location_url,
        )
        return self


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
    custom_location_name: str | None = None
    custom_location_url: str | None = None
    track_id: uuid.UUID | None = None
    visibility: EventVisibility | None = None
    require_approval: bool | None = None
    kind: str | None = None
    host_display_name: str | None = None
    status: EventStatus | None = None
    highlighted: bool | None = None

    @model_validator(mode="after")
    def _validate_custom_location(self) -> "EventUpdate":
        # Only validate when at least one of the relevant fields is being
        # touched in this patch — otherwise an unrelated PATCH (e.g.
        # ``{"title": "..."}``) would reject the update.
        if (
            self.venue_id is None
            and self.custom_location_name is None
            and self.custom_location_url is None
        ):
            return self
        _enforce_custom_location_xor(
            venue_id=self.venue_id,
            name=self.custom_location_name,
            url=self.custom_location_url,
        )
        return self


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
    # Effective booking mode resolved against the requested [start_time,
    # end_time]. Takes per-slot ``venue_weekly_hours.booking_mode`` overrides
    # into account so the portal can show a precise warning ("this time
    # requires approval") instead of a venue-wide hint.
    effective_booking_mode: str | None = None
    # Opaque conflict shapes for PRIVATE events the viewer cannot fully see.
    # Only populated by portal-authenticated endpoints (check_availability_portal).
    # Backoffice/admin callers always have full visibility and this list stays empty.
    opaque_conflicts: list[EventOpaque] = []


class EventRecurringAvailabilityCheck(BaseModel):
    """Payload for the recurrence-aware preflight endpoint.

    ``recurrence`` is optional — passing it ``None`` is equivalent to the
    single-window ``/check-availability`` call, but routed through the
    same result schema so the frontend has one branch.
    """

    venue_id: uuid.UUID
    start_time: datetime
    end_time: datetime
    timezone: str = "UTC"
    recurrence: RecurrenceRule | None = None
    exdates: list[str] = Field(default_factory=list)
    exclude_event_id: uuid.UUID | None = None


class OccurrenceConflict(BaseModel):
    """One offending instance returned by the recurrence preflight."""

    occurrence_start: datetime
    # Same label rendered by ``_format_occurrence_label`` so the frontend
    # mirrors the 409 message word-for-word.
    local_label: str
    reason: str
    conflicting_event_ids: list[uuid.UUID] = []
    # Up to three titles (mirrors the 409 message). Empty when the conflict
    # is not a booking clash (e.g. open hours, unbookable slot).
    conflicting_titles: list[str] = []
    effective_booking_mode: str | None = None


class EventRecurringAvailabilityResult(BaseModel):
    available: bool
    total_occurrences: int
    checked_occurrences: int
    conflicts: list[OccurrenceConflict] = []
    # True when the per-occurrence loop bailed at MAX_REPORTED. The UI uses
    # this to say "many occurrences conflict" vs an exact count.
    truncated: bool = False
