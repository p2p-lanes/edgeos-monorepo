"""Schemas for the accommodation module.

The ``*Base`` classes are the SQLModel table bases (see ``models.py``); the
``*Create`` / ``*Update`` / ``*Public`` classes are the API contract.

Money is ``Decimal`` end to end, never float. Dates are plain ``date``:
a stay is the half-open range ``[check_in, check_out)``, so a guest checking
out on the 8th and another checking in on the 8th share no night.
"""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, model_validator
from pydantic import Field as PydanticField
from sqlalchemy import String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, DateTime, Field, SQLModel

from app.api.accommodation.constants import (
    AccommodationKind,
    BedType,
    BookingKind,
    BookingStatus,
)


def _utcnow() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


class BedSpec(BaseModel):
    """One entry of ``accommodations.beds``: "2 single beds"."""

    type: BedType
    count: int = PydanticField(ge=1, le=50)

    model_config = ConfigDict(from_attributes=True)


class QuoteNight(BaseModel):
    """Price of a single night plus the rule that produced it."""

    date: date
    price: Decimal
    rule: str

    model_config = ConfigDict(from_attributes=True)


class AccommodationQuote(BaseModel):
    """Server-computed price of a stay. The client never sends prices.

    Stored verbatim in ``accommodation_bookings.price_snapshot`` and in the
    payment line's ``purchase_metadata.quote`` so a booking can always be
    explained after the fact, even if the rules change afterwards.
    """

    nights: list[QuoteNight]
    night_count: int
    subtotal: Decimal
    tax_percentage: Decimal | None = None
    tax: Decimal = Decimal("0.00")
    total: Decimal
    applied_rule: str
    currency: str | None = None

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------


class AccommodationPropertyBase(SQLModel):
    """A building that holds accommodations: a hotel, a camp, a house."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    name: str = Field(max_length=255)
    address: str | None = Field(default=None, sa_type=Text())
    description: str | None = Field(default=None, sa_type=Text())
    contact_email: str | None = Field(default=None, max_length=255)
    contact_name: str | None = Field(default=None, max_length=255)
    # Optional VAT / lodging tax applied on top of the nightly subtotal and
    # itemised in the quote. NULL = no tax line at all.
    tax_percentage: Decimal | None = Field(default=None, decimal_places=2, max_digits=5)
    is_active: bool = Field(default=True)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(
        default_factory=_utcnow, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime = Field(
        default_factory=_utcnow, sa_type=DateTime(timezone=True)
    )


class AccommodationPropertyCreate(BaseModel):
    popup_id: uuid.UUID
    name: str = PydanticField(min_length=1, max_length=255)
    address: str | None = None
    description: str | None = None
    contact_email: str | None = None
    contact_name: str | None = None
    tax_percentage: Decimal | None = PydanticField(default=None, ge=0, le=100)
    is_active: bool = True
    sort_order: int = 0


class AccommodationPropertyUpdate(BaseModel):
    name: str | None = PydanticField(default=None, min_length=1, max_length=255)
    address: str | None = None
    description: str | None = None
    contact_email: str | None = None
    contact_name: str | None = None
    tax_percentage: Decimal | None = PydanticField(default=None, ge=0, le=100)
    is_active: bool | None = None
    sort_order: int | None = None


class AccommodationPropertyPublic(AccommodationPropertyBase):
    id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Accommodations (room types)
# ---------------------------------------------------------------------------


class AccommodationBase(SQLModel):
    """A bookable *type* of room, backed by N interchangeable units.

    This is what the checkout shows and what the shadow ``Product`` mirrors.
    """

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    property_id: uuid.UUID = Field(
        foreign_key="accommodation_properties.id", index=True
    )
    # Internal product mirroring this accommodation so bookings can travel
    # through the existing payment rails. Managed by the backend, never by an
    # admin. Nullable only so the row can be created before its product.
    product_id: uuid.UUID | None = Field(
        default=None, foreign_key="products.id", nullable=True
    )
    name: str = Field(max_length=255)
    # Explicit String column: SQLModel would otherwise map the enum to
    # sa.Enum, which persists the member *name* ("ROOM") instead of its
    # value. Invisible in Python, but it breaks every raw-SQL predicate.
    kind: AccommodationKind = Field(
        default=AccommodationKind.ROOM,
        sa_column=Column(String(30), nullable=False, server_default="room"),
    )
    description: str | None = Field(default=None, sa_type=Text())
    guest_capacity: int = Field(default=1)
    beds: list[dict] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="'[]'::jsonb"),
    )
    default_nightly_price: Decimal = Field(decimal_places=2, max_digits=10)
    # Flat per-night price applied when the stay covers a whole month.
    # NULL = the accommodation has no long-stay rate.
    long_stay_price: Decimal | None = Field(
        default=None, decimal_places=2, max_digits=10
    )
    # NULL = inherit popups.accommodation_min_stay.
    min_stay_override: int | None = Field(default=None, nullable=True)
    # Window in which this accommodation can be booked. Independent of the
    # popup dates (C6): check_in >= bookable_from, check_out <= bookable_to.
    bookable_from: date
    bookable_to: date
    visible_in_checkout: bool = Field(default=True)
    is_active: bool = Field(default=True)
    sort_order: int = Field(default=0)
    deleted_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=_utcnow, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime = Field(
        default_factory=_utcnow, sa_type=DateTime(timezone=True)
    )


class AccommodationCreate(BaseModel):
    popup_id: uuid.UUID
    property_id: uuid.UUID
    name: str = PydanticField(min_length=1, max_length=255)
    kind: AccommodationKind = AccommodationKind.ROOM
    description: str | None = None
    guest_capacity: int = PydanticField(default=1, ge=1, le=100)
    beds: list[BedSpec] = PydanticField(default_factory=list)
    default_nightly_price: Decimal = PydanticField(ge=0)
    long_stay_price: Decimal | None = PydanticField(default=None, ge=0)
    min_stay_override: int | None = PydanticField(default=None, ge=1)
    bookable_from: date
    bookable_to: date
    visible_in_checkout: bool = True
    is_active: bool = True
    sort_order: int = 0
    # Convenience: create N units in the same call ("Double Room" x 12).
    units_count: int | None = PydanticField(default=None, ge=1, le=500)
    unit_label_prefix: str | None = None
    image_ids: list[uuid.UUID] | None = None

    @model_validator(mode="after")
    def _validate_window(self) -> "AccommodationCreate":
        if self.bookable_to <= self.bookable_from:
            raise ValueError("bookable_to must be after bookable_from")
        return self


class AccommodationUpdate(BaseModel):
    property_id: uuid.UUID | None = None
    name: str | None = PydanticField(default=None, min_length=1, max_length=255)
    kind: AccommodationKind | None = None
    description: str | None = None
    guest_capacity: int | None = PydanticField(default=None, ge=1, le=100)
    beds: list[BedSpec] | None = None
    default_nightly_price: Decimal | None = PydanticField(default=None, ge=0)
    long_stay_price: Decimal | None = PydanticField(default=None, ge=0)
    min_stay_override: int | None = PydanticField(default=None, ge=1)
    bookable_from: date | None = None
    bookable_to: date | None = None
    visible_in_checkout: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None
    image_ids: list[uuid.UUID] | None = None

    @model_validator(mode="after")
    def _validate_window(self) -> "AccommodationUpdate":
        if (
            self.bookable_from is not None
            and self.bookable_to is not None
            and self.bookable_to <= self.bookable_from
        ):
            raise ValueError("bookable_to must be after bookable_from")
        return self


class AccommodationUnitPublic(BaseModel):
    id: uuid.UUID
    accommodation_id: uuid.UUID
    label: str
    notes: str | None = None
    is_active: bool
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class AccommodationImagePublic(BaseModel):
    id: uuid.UUID
    url: str
    filename: str | None = None
    width: int | None = None
    height: int | None = None

    model_config = ConfigDict(from_attributes=True)


class AccommodationPublic(AccommodationBase):
    id: uuid.UUID
    units: list[AccommodationUnitPublic] = []
    images: list[AccommodationImagePublic] = []

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------


class AccommodationUnitBase(SQLModel):
    """A physical room. Bookings occupy units, never accommodations."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    accommodation_id: uuid.UUID = Field(
        foreign_key="accommodations.id", index=True, ondelete="CASCADE"
    )
    label: str = Field(max_length=100)
    notes: str | None = Field(default=None, sa_type=Text())
    is_active: bool = Field(default=True)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(
        default_factory=_utcnow, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime = Field(
        default_factory=_utcnow, sa_type=DateTime(timezone=True)
    )


class AccommodationUnitCreate(BaseModel):
    label: str = PydanticField(min_length=1, max_length=100)
    notes: str | None = None
    is_active: bool = True
    sort_order: int = 0


class AccommodationUnitBulkCreate(BaseModel):
    """Either explicit labels, or ``prefix`` + ``count`` -> "Room 1..N"."""

    labels: list[str] | None = None
    prefix: str | None = None
    count: int | None = PydanticField(default=None, ge=1, le=500)
    start_at: int = PydanticField(default=1, ge=0)

    @model_validator(mode="after")
    def _validate_source(self) -> "AccommodationUnitBulkCreate":
        if not self.labels and not (self.prefix is not None and self.count):
            raise ValueError("provide either labels[] or prefix + count")
        return self


class AccommodationUnitUpdate(BaseModel):
    label: str | None = PydanticField(default=None, min_length=1, max_length=100)
    notes: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None


# ---------------------------------------------------------------------------
# Price rules
# ---------------------------------------------------------------------------


class AccommodationPriceRuleBase(SQLModel):
    """Nightly price override for a closed date range (both ends inclusive).

    Weekend pricing, high season and one-off promos are all expressed with
    these; there is no separate weekend concept (C4).
    """

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    accommodation_id: uuid.UUID = Field(
        foreign_key="accommodations.id", index=True, ondelete="CASCADE"
    )
    label: str | None = Field(default=None, max_length=255)
    start_date: date
    end_date: date
    nightly_price: Decimal = Field(decimal_places=2, max_digits=10)
    # Higher wins when two rules cover the same night; ties break on the most
    # recently created rule.
    priority: int = Field(default=0)
    created_at: datetime = Field(
        default_factory=_utcnow, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime = Field(
        default_factory=_utcnow, sa_type=DateTime(timezone=True)
    )


class AccommodationPriceRuleCreate(BaseModel):
    label: str | None = None
    start_date: date
    end_date: date
    nightly_price: Decimal = PydanticField(ge=0)
    priority: int = 0

    @model_validator(mode="after")
    def _validate_range(self) -> "AccommodationPriceRuleCreate":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class AccommodationPriceRuleUpdate(BaseModel):
    label: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    nightly_price: Decimal | None = PydanticField(default=None, ge=0)
    priority: int | None = None


class AccommodationPriceRulePublic(AccommodationPriceRuleBase):
    id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------


class BookingGuest(BaseModel):
    """One occupant.

    Names are collected in the checkout and exported to the property owner,
    who needs them for their own registry.
    """

    name: str = PydanticField(min_length=1, max_length=255)

    model_config = ConfigDict(from_attributes=True)


class AccommodationBookingBase(SQLModel):
    """A unit occupied for a date range.

    Overlap is prevented by a Postgres exclusion constraint on
    ``(unit_id, daterange(check_in, check_out))`` restricted to the blocking
    statuses: the database, not the application, is what guarantees no
    double-booking.
    """

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    accommodation_id: uuid.UUID = Field(foreign_key="accommodations.id", index=True)
    unit_id: uuid.UUID = Field(foreign_key="accommodation_units.id", index=True)
    # String columns, not sa.Enum: the exclusion constraint filters on
    # `status IN ('hold', 'confirmed')` in SQL, so the stored text has to
    # be the enum *value*. sa.Enum would store the member name and the
    # constraint would silently stop matching any row.
    kind: BookingKind = Field(
        default=BookingKind.GUEST,
        sa_column=Column(String(20), nullable=False, server_default="guest"),
    )
    status: BookingStatus = Field(
        default=BookingStatus.HOLD,
        sa_column=Column(String(20), nullable=False, server_default="hold", index=True),
    )
    check_in: date = Field(index=True)
    check_out: date
    guest_count: int | None = Field(default=None, nullable=True)
    guests: list[dict] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="'[]'::jsonb"),
    )
    primary_guest_name: str | None = Field(default=None, max_length=255)
    primary_guest_email: str | None = Field(default=None, max_length=255)
    # Denormalised links to the rest of the system. No FK on payment_product_id
    # so a booking outlives a re-issued payment line.
    attendee_id: uuid.UUID | None = Field(default=None, nullable=True, index=True)
    human_id: uuid.UUID | None = Field(default=None, nullable=True, index=True)
    payment_id: uuid.UUID | None = Field(default=None, nullable=True, index=True)
    payment_product_id: uuid.UUID | None = Field(default=None, nullable=True)
    price_snapshot: dict | None = Field(
        default=None, sa_column=Column(JSONB, nullable=True)
    )
    hold_expires_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    notes: str | None = Field(default=None, sa_type=Text())
    created_by_user_id: uuid.UUID | None = Field(default=None, nullable=True)
    created_at: datetime = Field(
        default_factory=_utcnow, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime = Field(
        default_factory=_utcnow, sa_type=DateTime(timezone=True)
    )


class AccommodationBookingCreate(BaseModel):
    """Staff-created booking (comp, block, maintenance).

    ``unit_id`` is optional: without it the backend picks a free unit of the
    accommodation with the same best-fit logic the checkout uses.
    """

    popup_id: uuid.UUID
    accommodation_id: uuid.UUID
    unit_id: uuid.UUID | None = None
    kind: BookingKind = BookingKind.GUEST
    check_in: date
    check_out: date
    guest_count: int | None = PydanticField(default=None, ge=1)
    guests: list[BookingGuest] = PydanticField(default_factory=list)
    primary_guest_name: str | None = None
    primary_guest_email: str | None = None
    notes: str | None = None
    # Staff bookings skip the min-stay / bookable-window checks when set.
    ignore_restrictions: bool = False

    @model_validator(mode="after")
    def _validate_range(self) -> "AccommodationBookingCreate":
        if self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        return self


class AccommodationBookingUpdate(BaseModel):
    unit_id: uuid.UUID | None = None
    status: BookingStatus | None = None
    guest_count: int | None = PydanticField(default=None, ge=1)
    guests: list[BookingGuest] | None = None
    primary_guest_name: str | None = None
    primary_guest_email: str | None = None
    notes: str | None = None


class AccommodationBookingPublic(AccommodationBookingBase):
    id: uuid.UUID
    nights: int = 0

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def _fill_nights(self) -> "AccommodationBookingPublic":
        if not self.nights:
            self.nights = (self.check_out - self.check_in).days
        return self


# ---------------------------------------------------------------------------
# Image library
# ---------------------------------------------------------------------------


class AccommodationImageBase(SQLModel):
    """Popup-wide photo bank.

    Photos are uploaded once and linked to any number of accommodations, so a
    property's shared shots are not re-uploaded for every room type.
    """

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    url: str = Field(sa_type=Text())
    filename: str | None = Field(default=None, max_length=255)
    width: int | None = Field(default=None, nullable=True)
    height: int | None = Field(default=None, nullable=True)
    uploaded_by_user_id: uuid.UUID | None = Field(default=None, nullable=True)
    created_at: datetime = Field(
        default_factory=_utcnow, sa_type=DateTime(timezone=True)
    )


class AccommodationImageCreate(BaseModel):
    popup_id: uuid.UUID
    url: str
    filename: str | None = None
    width: int | None = None
    height: int | None = None


class AccommodationImageUpdate(BaseModel):
    filename: str | None = None


class AccommodationImageLinkBase(SQLModel):
    """Ordered link between an accommodation and a library image."""

    accommodation_id: uuid.UUID = Field(
        foreign_key="accommodations.id", primary_key=True, ondelete="CASCADE"
    )
    image_id: uuid.UUID = Field(
        foreign_key="accommodation_images.id", primary_key=True, ondelete="CASCADE"
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    sort_order: int = Field(default=0)


# ---------------------------------------------------------------------------
# Availability / quote responses
# ---------------------------------------------------------------------------


class AccommodationAvailabilityRequest(BaseModel):
    check_in: date
    check_out: date
    # Optional: the portal sends the party size so a room that cannot hold it
    # comes back as unavailable here, instead of as a rejected purchase three
    # screens later.
    guest_count: int | None = PydanticField(default=None, ge=1, le=50)

    @model_validator(mode="after")
    def _validate_range(self) -> "AccommodationAvailabilityRequest":
        if self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        return self


class AccommodationAvailability(BaseModel):
    """Per-accommodation answer to "can I book these dates, and for how much".

    ``available`` is a count, not a boolean: the checkout shows "3 left".
    ``unavailable_reason`` explains a zero so the UI can say *why* (too short
    a stay, outside the bookable window, sold out).
    """

    accommodation_id: uuid.UUID
    available: int
    quote: AccommodationQuote | None = None
    unavailable_reason: str | None = None

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Bulk operations
# ---------------------------------------------------------------------------


class AccommodationBulkFilter(BaseModel):
    """Selects room types by attribute instead of by id.

    Exists so an operator (or an agent over MCP) can say "every room in this
    property" without first listing them.
    """

    popup_id: uuid.UUID
    property_id: uuid.UUID | None = None
    kind: AccommodationKind | None = None
    is_active: bool | None = None


class AccommodationBulkUpdateRequest(BaseModel):
    """Apply one patch to many room types.

    Named ``...Request`` rather than ``...Update`` on purpose: this is the
    envelope of a bulk endpoint, not a PATCH body. The PATCH body it carries
    is ``patch``, and that one is a real ``*Update`` schema.
    """

    ids: list[uuid.UUID] | None = None
    filter: AccommodationBulkFilter | None = None
    patch: AccommodationUpdate

    @model_validator(mode="after")
    def _validate_target(self) -> "AccommodationBulkUpdateRequest":
        if not self.ids and self.filter is None:
            raise ValueError("provide either ids[] or filter")
        return self


class BulkPriceMode(StrEnum):
    SET = "set"
    PERCENT = "percent"


class AccommodationBulkPrice(BaseModel):
    """Re-price many room types at once.

    Without a date range this moves ``default_nightly_price``; with one it
    creates (or replaces) a date-range rule per room type, which is how a
    "high season +20%" is expressed.
    """

    ids: list[uuid.UUID] | None = None
    filter: AccommodationBulkFilter | None = None
    mode: BulkPriceMode = BulkPriceMode.SET
    value: Decimal
    start_date: date | None = None
    end_date: date | None = None
    label: str | None = None
    priority: int = 0

    @model_validator(mode="after")
    def _validate(self) -> "AccommodationBulkPrice":
        if not self.ids and self.filter is None:
            raise ValueError("provide either ids[] or filter")
        if (self.start_date is None) != (self.end_date is None):
            raise ValueError("start_date and end_date must be given together")
        if (
            self.start_date is not None
            and self.end_date is not None
            and self.end_date < self.start_date
        ):
            raise ValueError("end_date must be on or after start_date")
        if self.mode is BulkPriceMode.SET and self.value < 0:
            raise ValueError("value must be >= 0")
        return self


class AccommodationDuplicate(BaseModel):
    """Copy a room type, optionally with its units and price rules."""

    name: str | None = None
    copy_units: bool = True
    units_count: int | None = PydanticField(default=None, ge=1, le=500)
    copy_price_rules: bool = True
    copy_images: bool = True


class BulkResult(BaseModel):
    """How many rows a bulk call touched. Deliberately not the rows
    themselves: a bulk over a whole property would be a huge response."""

    updated: int


# ---------------------------------------------------------------------------
# Bookings: staff operations
# ---------------------------------------------------------------------------


class AccommodationBlockRange(BaseModel):
    """Take a whole room type off the market for a range.

    One booking per unit, so the calendar shows the block on every row and
    the exclusion constraint keeps guests out.
    """

    popup_id: uuid.UUID
    accommodation_id: uuid.UUID
    check_in: date
    check_out: date
    kind: BookingKind = BookingKind.BLOCK
    notes: str | None = None

    @model_validator(mode="after")
    def _validate_range(self) -> "AccommodationBlockRange":
        if self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        if self.kind is BookingKind.GUEST:
            raise ValueError("block-range is for block/maintenance bookings only")
        return self


class BlockRangeResult(BaseModel):
    created: int
    skipped: int
    booking_ids: list[uuid.UUID]


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------


class CalendarBooking(BaseModel):
    """One bar on the calendar."""

    id: uuid.UUID
    unit_id: uuid.UUID
    accommodation_id: uuid.UUID
    kind: BookingKind
    status: BookingStatus
    check_in: date
    check_out: date
    nights: int
    guest_count: int | None = None
    primary_guest_name: str | None = None
    primary_guest_email: str | None = None
    payment_id: uuid.UUID | None = None
    total: Decimal | None = None
    notes: str | None = None

    model_config = ConfigDict(from_attributes=True)


class CalendarUnit(BaseModel):
    """One row of the calendar."""

    id: uuid.UUID
    label: str
    is_active: bool
    bookings: list[CalendarBooking] = []


class CalendarAccommodation(BaseModel):
    id: uuid.UUID
    name: str
    kind: AccommodationKind
    guest_capacity: int
    is_active: bool = True
    # The nights this room type can be sold for. Sent so the calendar can grey
    # out everything outside it: an empty unit on a night nobody is allowed to
    # book is not availability, and an operator reading the row as if it were
    # will promise a stay the checkout then refuses.
    bookable_from: date
    bookable_to: date
    units: list[CalendarUnit] = []
    # Free units per day, keyed by ISO date: the "Available" row under each
    # room type. Computed server-side so the client never re-derives it, and
    # zero outside the window, so the number and the greying always agree.
    availability_by_day: dict[str, int] = {}


class CalendarProperty(BaseModel):
    id: uuid.UUID
    name: str
    accommodations: list[CalendarAccommodation] = []


class AccommodationCalendar(BaseModel):
    date_from: date
    date_to: date
    properties: list[CalendarProperty] = []


# ---------------------------------------------------------------------------
# Public checkout (portal)
# ---------------------------------------------------------------------------


class PublicAccommodationProperty(BaseModel):
    """A property as the buyer sees it.

    Deliberately narrower than ``AccommodationPropertyPublic``: the contact
    name and email belong to the operator's relationship with the owner, not
    to a checkout page. The tax percentage is exposed because it shows up as
    a line in the quote and the buyer is entitled to know why.
    """

    id: uuid.UUID
    name: str
    address: str | None = None
    description: str | None = None
    tax_percentage: Decimal | None = None


class PublicAccommodation(BaseModel):
    """A room type as the buyer sees it.

    No units: how many rooms exist, and which one a guest lands in, is the
    operator's business. What the checkout needs is whether *a* room is free,
    which is what the availability endpoint answers.
    """

    id: uuid.UUID
    property_id: uuid.UUID
    product_id: uuid.UUID | None = None
    name: str
    kind: AccommodationKind
    description: str | None = None
    guest_capacity: int
    beds: list[BedSpec] = []
    default_nightly_price: Decimal
    long_stay_price: Decimal | None = None
    # Resolved here rather than left to the client: it is the accommodation's
    # override, else the popup default, else one night, and the portal must
    # not re-implement that precedence.
    min_stay: int
    bookable_from: date
    bookable_to: date
    images: list[AccommodationImagePublic] = []


class AccommodationOffer(BaseModel):
    """Everything the accommodation step needs to render before dates exist."""

    properties: list[PublicAccommodationProperty] = []
    accommodations: list[PublicAccommodation] = []
    currency: str | None = None


class PublicAccommodationAvailability(BaseModel):
    """What a room type costs for these dates, and whether it can be had.

    The quote is server-computed and comes back with the availability so the
    checkout never multiplies a nightly price by a night count, because date-range
    rules and the long-stay price make that arithmetic wrong more often than
    it is right.
    """

    accommodation_id: uuid.UUID
    available: int
    unavailable_reason: str | None = None
    quote: AccommodationQuote | None = None
