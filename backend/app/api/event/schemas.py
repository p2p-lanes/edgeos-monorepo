import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, DateTime, Field, SQLModel


class EventStatus(str, Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    CANCELLED = "cancelled"


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
    location: str | None = Field(default=None, sa_type=Text())
    geo_lat: float | None = Field(default=None)
    geo_lng: float | None = Field(default=None)
    cover_url: str | None = Field(default=None, sa_type=Text())
    meeting_url: str | None = Field(default=None, sa_type=Text())
    max_participant: int | None = Field(default=None)
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSONB, nullable=False, server_default="[]"))
    venue_id: uuid.UUID | None = Field(default=None, foreign_key="event_venues.id")
    require_approval: bool = Field(default=False)
    kind: str | None = Field(default=None, max_length=100)
    status: EventStatus = Field(default=EventStatus.DRAFT)
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

    model_config = ConfigDict(from_attributes=True)


class EventCreate(BaseModel):
    """Event schema for creation."""

    popup_id: uuid.UUID
    title: str
    content: str | None = None
    start_time: datetime
    end_time: datetime
    timezone: str = "UTC"
    location: str | None = None
    geo_lat: float | None = None
    geo_lng: float | None = None
    cover_url: str | None = None
    meeting_url: str | None = None
    max_participant: int | None = None
    tags: list[str] = []
    venue_id: uuid.UUID | None = None
    require_approval: bool = False
    kind: str | None = None
    status: EventStatus = EventStatus.DRAFT

    model_config = ConfigDict(str_strip_whitespace=True)


class EventUpdate(BaseModel):
    """Event schema for updates."""

    title: str | None = None
    content: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    timezone: str | None = None
    location: str | None = None
    geo_lat: float | None = None
    geo_lng: float | None = None
    cover_url: str | None = None
    meeting_url: str | None = None
    max_participant: int | None = None
    tags: list[str] | None = None
    venue_id: uuid.UUID | None = None
    require_approval: bool | None = None
    kind: str | None = None
    status: EventStatus | None = None
