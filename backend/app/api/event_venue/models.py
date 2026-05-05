import uuid
from datetime import datetime, time
from typing import TYPE_CHECKING

from sqlalchemy import Text, Time
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, SQLModel

from app.api.event_venue.schemas import EventVenueBase

if TYPE_CHECKING:
    from app.api.event.models import Events
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


class EventVenues(EventVenueBase, table=True):
    """Venue model for event locations."""

    __tablename__ = "event_venues"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    tenant: "Tenants" = Relationship()
    popup: "Popups" = Relationship()
    events: list["Events"] = Relationship(back_populates="venue")

    properties: list["VenueProperties"] = Relationship(
        back_populates="venue", cascade_delete=True
    )
    photos: list["VenuePhotos"] = Relationship(
        back_populates="venue", cascade_delete=True
    )
    weekly_hours: list["VenueWeeklyHours"] = Relationship(
        back_populates="venue", cascade_delete=True
    )
    exceptions: list["VenueExceptions"] = Relationship(
        back_populates="venue", cascade_delete=True
    )


class VenuePropertyTypes(SQLModel, table=True):
    """Tenant-scoped catalog of venue property types (microphone, screen, ...)."""

    __tablename__ = "venue_property_types"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str = Field(max_length=100)
    icon: str | None = Field(default=None, max_length=100)
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_type=DateTime(timezone=True)
    )

    properties: list["VenueProperties"] = Relationship(
        back_populates="property_type", cascade_delete=True
    )


class VenueProperties(SQLModel, table=True):
    """Join table between venues and property types."""

    __tablename__ = "venue_properties"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    venue_id: uuid.UUID = Field(foreign_key="event_venues.id", index=True)
    property_type_id: uuid.UUID = Field(
        foreign_key="venue_property_types.id", index=True
    )

    venue: "EventVenues" = Relationship(back_populates="properties")
    property_type: "VenuePropertyTypes" = Relationship(back_populates="properties")


class VenuePhotos(SQLModel, table=True):
    """Venue gallery photos (main photo is on EventVenues.image_url)."""

    __tablename__ = "venue_photos"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    venue_id: uuid.UUID = Field(foreign_key="event_venues.id", index=True)
    image_url: str = Field(sa_type=Text())
    position: int = Field(default=0)
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_type=DateTime(timezone=True)
    )

    venue: "EventVenues" = Relationship(back_populates="photos")


class VenueWeeklyHours(SQLModel, table=True):
    """Weekly opening hours per venue. day_of_week is ISO (0=Mon, 6=Sun)."""

    __tablename__ = "venue_weekly_hours"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    venue_id: uuid.UUID = Field(foreign_key="event_venues.id", index=True)
    day_of_week: int = Field(ge=0, le=6)
    open_time: time | None = Field(default=None, sa_column=Column(Time(timezone=False)))
    close_time: time | None = Field(
        default=None, sa_column=Column(Time(timezone=False))
    )
    is_closed: bool = Field(default=False)

    venue: "EventVenues" = Relationship(back_populates="weekly_hours")


class VenueExceptions(SQLModel, table=True):
    """Date/datetime range overrides to a venue's normal weekly hours."""

    __tablename__ = "venue_exceptions"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    venue_id: uuid.UUID = Field(foreign_key="event_venues.id", index=True)
    start_datetime: datetime = Field(sa_type=DateTime(timezone=True))
    end_datetime: datetime = Field(sa_type=DateTime(timezone=True))
    reason: str | None = Field(default=None, sa_type=Text())
    is_closed: bool = Field(default=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_type=DateTime(timezone=True)
    )

    venue: "EventVenues" = Relationship(back_populates="exceptions")
