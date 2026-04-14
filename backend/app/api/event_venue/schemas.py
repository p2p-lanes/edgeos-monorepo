import uuid
from datetime import datetime, time
from enum import Enum

from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, DateTime, Field, SQLModel


class VenueBookingMode(str, Enum):
    FREE = "free"
    APPROVAL_REQUIRED = "approval_required"
    UNBOOKABLE = "unbookable"


class VenueStatus(str, Enum):
    PENDING = "pending"
    ACTIVE = "active"


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
    booking_mode: VenueBookingMode = Field(default=VenueBookingMode.FREE, max_length=30)
    setup_time_minutes: int = Field(default=0)
    teardown_time_minutes: int = Field(default=0)
    status: VenueStatus = Field(default=VenueStatus.ACTIVE, max_length=20)
    created_at: datetime = Field(default_factory=datetime.utcnow, sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_type=DateTime(timezone=True))


class VenuePropertyRef(BaseModel):
    """Flattened view of a venue property: carries the property_type fields
    (id, name, icon) regardless of whether the ORM passes us a join row or a
    direct VenuePropertyTypes row.
    """

    id: uuid.UUID
    name: str
    icon: str | None = None

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def _flatten_join(cls, data):
        # Accept a VenueProperties join row and resolve through its
        # property_type relationship. Leaves plain dicts / direct
        # VenuePropertyTypes rows untouched.
        if hasattr(data, "property_type") and data.property_type is not None:
            pt = data.property_type
            return {
                "id": pt.id,
                "name": pt.name,
                "icon": pt.icon,
            }
        return data


class VenuePhotoRef(BaseModel):
    id: uuid.UUID
    image_url: str
    position: int

    model_config = ConfigDict(from_attributes=True)


class VenueWeeklyHourRef(BaseModel):
    id: uuid.UUID
    day_of_week: int
    open_time: time | None
    close_time: time | None
    is_closed: bool

    model_config = ConfigDict(from_attributes=True)


class VenueExceptionRef(BaseModel):
    id: uuid.UUID
    start_datetime: datetime
    end_datetime: datetime
    reason: str | None = None
    is_closed: bool

    model_config = ConfigDict(from_attributes=True)


class EventVenuePublic(EventVenueBase):
    """Venue schema for API responses."""

    id: uuid.UUID
    properties: list[VenuePropertyRef] = []
    photos: list[VenuePhotoRef] = []
    weekly_hours: list[VenueWeeklyHourRef] = []
    exceptions: list[VenueExceptionRef] = []

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
    booking_mode: VenueBookingMode = VenueBookingMode.FREE
    setup_time_minutes: int = 0
    teardown_time_minutes: int = 0
    property_type_ids: list[uuid.UUID] = []

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
    booking_mode: VenueBookingMode | None = None
    setup_time_minutes: int | None = None
    teardown_time_minutes: int | None = None
    status: VenueStatus | None = None
    property_type_ids: list[uuid.UUID] | None = None


# ---------------------------------------------------------------------------
# Weekly hours
# ---------------------------------------------------------------------------


class VenueWeeklyHourInput(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    open_time: time | None = None
    close_time: time | None = None
    is_closed: bool = False


class VenueWeeklyHoursUpdate(BaseModel):
    hours: list[VenueWeeklyHourInput]


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class VenueExceptionCreate(BaseModel):
    start_datetime: datetime
    end_datetime: datetime
    reason: str | None = None
    is_closed: bool = True


class VenueExceptionUpdate(BaseModel):
    start_datetime: datetime | None = None
    end_datetime: datetime | None = None
    reason: str | None = None
    is_closed: bool | None = None


class VenueExceptionPublic(BaseModel):
    id: uuid.UUID
    venue_id: uuid.UUID
    tenant_id: uuid.UUID
    start_datetime: datetime
    end_datetime: datetime
    reason: str | None = None
    is_closed: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Property types catalog (tenant-scoped)
# ---------------------------------------------------------------------------


class VenuePropertyTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    icon: str | None = Field(default=None, max_length=100)


class VenuePropertyTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    icon: str | None = Field(default=None, max_length=100)


class VenuePropertyTypePublic(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    icon: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Photos (gallery)
# ---------------------------------------------------------------------------


class VenuePhotoCreate(BaseModel):
    image_url: str
    position: int = 0


class VenuePhotoUpdate(BaseModel):
    image_url: str | None = None
    position: int | None = None


class VenuePhotoPublic(BaseModel):
    id: uuid.UUID
    venue_id: uuid.UUID
    image_url: str
    position: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Availability query
# ---------------------------------------------------------------------------


class VenueBusySlot(BaseModel):
    start: datetime
    end: datetime
    source: str  # "event" | "exception"
    label: str | None = None


class VenueAvailability(BaseModel):
    venue_id: uuid.UUID
    open_ranges: list[tuple[datetime, datetime]]
    busy: list[VenueBusySlot]
