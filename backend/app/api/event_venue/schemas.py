import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, DateTime, Field, SQLModel


class EventVenueBase(SQLModel):
    """Base venue schema."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    owner_id: uuid.UUID = Field(index=True)
    title: str = Field(max_length=255)
    location: str | None = Field(default=None, sa_type=Text())
    formatted_address: str | None = Field(default=None, sa_type=Text())
    geo_lat: float | None = Field(default=None)
    geo_lng: float | None = Field(default=None)
    capacity: int | None = Field(default=None)
    start_date: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    end_date: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    amenities: list[str] = Field(default_factory=list, sa_column=Column(JSONB, nullable=False, server_default="[]"))
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSONB, nullable=False, server_default="[]"))
    image_url: str | None = Field(default=None, sa_type=Text())
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_type=DateTime(timezone=True))


class EventVenuePublic(EventVenueBase):
    """Venue schema for API responses."""

    id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


class EventVenueCreate(BaseModel):
    """Venue schema for creation."""

    popup_id: uuid.UUID
    title: str
    location: str | None = None
    formatted_address: str | None = None
    geo_lat: float | None = None
    geo_lng: float | None = None
    capacity: int | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    amenities: list[str] = []
    tags: list[str] = []
    image_url: str | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class EventVenueUpdate(BaseModel):
    """Venue schema for updates."""

    title: str | None = None
    location: str | None = None
    formatted_address: str | None = None
    geo_lat: float | None = None
    geo_lng: float | None = None
    capacity: int | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    amenities: list[str] | None = None
    tags: list[str] | None = None
    image_url: str | None = None
