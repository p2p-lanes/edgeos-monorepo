import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, DateTime, Field, SQLModel


class TrackBase(SQLModel):
    """Base track schema — a series of related events."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    name: str = Field(max_length=255)
    description: str | None = Field(default=None, sa_type=Text())
    topic: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="[]"),
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow, sa_type=DateTime(timezone=True)
    )


class TrackPublic(TrackBase):
    id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


class TrackCreate(BaseModel):
    popup_id: uuid.UUID
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    topic: list[str] = []

    model_config = ConfigDict(str_strip_whitespace=True)


class TrackUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    topic: list[str] | None = None
