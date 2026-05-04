import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import DateTime, Field, SQLModel


class PublishPermission(str, Enum):
    ADMIN_ONLY = "admin_only"
    EVERYONE = "everyone"


class EventSettingsBase(SQLModel):
    """Base event settings schema."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", unique=True, index=True)
    can_publish_event: PublishPermission = Field(default=PublishPermission.EVERYONE)
    event_enabled: bool = Field(default=True)
    humans_can_create_venues: bool = Field(default=False)
    venues_require_approval: bool = Field(default=True)
    # When ``can_publish_event`` is EVERYONE, this flag controls whether
    # human-created events stay in PENDING_APPROVAL until an admin approves
    # them. Ignored when ``can_publish_event`` is ADMIN_ONLY.
    events_require_approval: bool = Field(default=True)
    timezone: str = Field(default="UTC", max_length=64)
    # Tags an admin has whitelisted. Portal EventForm offers these as
    # selectable chips; free-text tag entry is disabled.
    allowed_tags: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="[]"),
    )
    # Event "kind" / type values an admin has whitelisted. Backoffice and
    # portal EventForms render these as a single-select dropdown; free-text
    # entry is disabled. Mirror of allowed_tags.
    allowed_kinds: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="[]"),
    )
    # Email that receives notifications when an event or venue is submitted
    # and requires approval. Falls back to the popup owner if unset.
    approval_notification_email: str | None = Field(default=None, sa_type=Text())
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow, sa_type=DateTime(timezone=True)
    )


class EventSettingsPublic(EventSettingsBase):
    """Event settings schema for API responses."""

    id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


class EventSettingsCreate(BaseModel):
    """Event settings schema for creation."""

    popup_id: uuid.UUID
    can_publish_event: PublishPermission = PublishPermission.EVERYONE
    event_enabled: bool = True
    humans_can_create_venues: bool = False
    venues_require_approval: bool = True
    events_require_approval: bool = True
    timezone: str = "UTC"
    allowed_tags: list[str] = []
    allowed_kinds: list[str] = []
    approval_notification_email: str | None = None


class EventSettingsUpdate(BaseModel):
    """Event settings schema for updates."""

    can_publish_event: PublishPermission | None = None
    event_enabled: bool | None = None
    humans_can_create_venues: bool | None = None
    venues_require_approval: bool | None = None
    events_require_approval: bool | None = None
    timezone: str | None = None
    allowed_tags: list[str] | None = None
    allowed_kinds: list[str] | None = None
    approval_notification_email: str | None = None
