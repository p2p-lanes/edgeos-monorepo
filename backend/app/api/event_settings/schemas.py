import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict
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
    timezone: str = Field(default="UTC", max_length=64)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_type=DateTime(timezone=True))


class EventSettingsPublic(EventSettingsBase):
    """Event settings schema for API responses."""

    id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


class EventSettingsCreate(BaseModel):
    """Event settings schema for creation."""

    popup_id: uuid.UUID
    can_publish_event: PublishPermission = PublishPermission.EVERYONE
    event_enabled: bool = True
    timezone: str = "UTC"


class EventSettingsUpdate(BaseModel):
    """Event settings schema for updates."""

    can_publish_event: PublishPermission | None = None
    event_enabled: bool | None = None
    timezone: str | None = None
