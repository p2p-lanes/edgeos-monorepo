import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Text
from sqlmodel import DateTime, Field, SQLModel


class ParticipantStatus(str, Enum):
    REGISTERED = "registered"
    CHECKED_IN = "checked_in"
    CANCELLED = "cancelled"


class ParticipantRole(str, Enum):
    HOST = "host"
    SPEAKER = "speaker"
    ATTENDEE = "attendee"


class EventParticipantBase(SQLModel):
    """Base participant schema."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    event_id: uuid.UUID = Field(foreign_key="events.id", index=True)
    profile_id: uuid.UUID = Field(index=True)
    status: ParticipantStatus = Field(default=ParticipantStatus.REGISTERED)
    role: ParticipantRole = Field(default=ParticipantRole.ATTENDEE)
    # Set when the registration targets a single occurrence of a recurring
    # event. NULL for one-off events (the row applies to the event itself).
    occurrence_start: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    check_time: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    message: str | None = Field(default=None, sa_type=Text())
    registered_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_type=DateTime(timezone=True),
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_type=DateTime(timezone=True),
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_type=DateTime(timezone=True),
    )


class EventParticipantPublic(EventParticipantBase):
    """Participant schema for API responses."""

    id: uuid.UUID
    # Joined from Humans. Populated by router helpers when listing participants
    # so clients can render a real name instead of a UUID; None when the
    # referenced human is missing (deleted / cross-tenant link).
    first_name: str | None = None
    last_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class EventParticipantCreate(BaseModel):
    """Participant schema for creation (admin adding participant)."""

    event_id: uuid.UUID
    profile_id: uuid.UUID
    role: ParticipantRole = ParticipantRole.ATTENDEE
    message: str | None = None
    occurrence_start: datetime | None = None


class EventParticipantUpdate(BaseModel):
    """Participant schema for updates."""

    status: ParticipantStatus | None = None
    role: ParticipantRole | None = None
    message: str | None = None


class RegisterRequest(BaseModel):
    """Request body for self-registration."""

    role: ParticipantRole = ParticipantRole.ATTENDEE
    message: str | None = None
    # Set when registering for a single occurrence of a recurring event.
    occurrence_start: datetime | None = None
