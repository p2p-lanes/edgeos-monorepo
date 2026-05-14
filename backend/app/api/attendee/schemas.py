import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlmodel import Column, Field, SQLModel

from app.api.product.schemas import ProductWithQuantity


class AttendeeBase(SQLModel):
    """Base attendee schema."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    application_id: uuid.UUID | None = Field(
        default=None, foreign_key="applications.id", index=True, nullable=True
    )
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    human_id: uuid.UUID | None = Field(
        default=None, foreign_key="humans.id", index=True, nullable=True
    )
    name: str
    # FK to attendee_categories (authoritative)
    category_id: uuid.UUID | None = Field(
        default=None,
        foreign_key="attendee_categories.id",
        index=True,
        nullable=True,
    )
    email: str | None = Field(default=None, nullable=True)
    gender: str | None = Field(default=None, nullable=True)
    check_in_code: str | None = Field(default=None, index=True, nullable=True)
    poap_url: str | None = Field(default=None, nullable=True)


class AttendeePublic(AttendeeBase):
    """Attendee schema for API responses (detail view).

    products is typed as list[AttendeeProductPublic] so each entry carries
    check_in_code, payment_id, and requires_check_in. The list endpoint
    (GET /attendees) uses the separate AttendeeListItem schema which keeps
    the legacy ProductWithQuantity shape for backwards compatibility.

    category is provided as a string (from the Attendees.category @property)
    for backward compatibility. The authoritative shape is category_id (UUID FK).
    """

    id: uuid.UUID
    category: str | None = None  # derived from category_id FK via ORM property
    created_at: datetime | None = None
    updated_at: datetime | None = None
    products: list["AttendeeProductPublic"] = []
    human_id: uuid.UUID | None = None

    model_config = ConfigDict(from_attributes=True)


class AttendeeCreate(BaseModel):
    """Attendee schema for creation (by user).

    Accepts category_id (UUID FK) as the primary input. The legacy `category`
    string field is kept for backward compatibility but the router now validates
    via category_id against the popup's attendee_categories table.
    """

    name: str
    category_id: uuid.UUID | None = None
    # Legacy string kept for existing callers; prefer category_id for new code
    category: str | None = None
    email: str | None = None
    gender: str | None = None

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: str | None) -> str | None:
        if v:
            return v.lower().strip()
        return None

    model_config = ConfigDict(str_strip_whitespace=True)


class AttendeeUpdate(BaseModel):
    """Attendee schema for updates."""

    name: str | None = None
    email: str | None = None
    gender: str | None = None
    # Category cannot be changed once set if products exist

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: str | None) -> str | None:
        if v:
            return v.lower().strip()
        return None


class AttendeeInternalCreate(AttendeeCreate):
    """Internal attendee schema with all fields."""

    application_id: uuid.UUID
    check_in_code: str


class AttendeeProductsBase(SQLModel):
    """Base schema for attendee products link table (first-class Ticket entity).

    Each row represents exactly one ticket. The composite PK on (attendee_id, product_id)
    has been replaced by a UUID PK 'id'. The 'quantity' column is dropped — callers
    must create N rows to represent N tickets.
    """

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            PgUUID(as_uuid=True),
            primary_key=True,
        ),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    attendee_id: uuid.UUID = Field(foreign_key="attendees.id", index=True)
    product_id: uuid.UUID = Field(foreign_key="products.id", index=True)
    check_in_code: str = Field(index=True)
    payment_id: uuid.UUID | None = Field(
        default=None,
        foreign_key="payments.id",
        nullable=True,
        index=True,
    )


class AttendeeProductPublic(BaseModel):
    """Schema for an individual ticket (one row per ticket, no quantity).

    requires_check_in is denormalized from the related Product so the frontend
    can decide whether to render a QR code without an extra round-trip.

    product_name, product_category, and duration_type are denormalized from the
    related Product at response-build time (current product state, not
    snapshot-at-purchase). All are optional with None defaults for backward
    compatibility with old clients that do not read them.

    last_scan_at is the most recent occurred_at from check_ins for this ticket
    (None when the ticket has never been scanned). Populated by the router from
    a batched aggregation so portal UIs can flag already-used QR codes.
    """

    id: uuid.UUID
    attendee_id: uuid.UUID
    product_id: uuid.UUID
    check_in_code: str
    payment_id: uuid.UUID | None = None
    requires_check_in: bool = False
    product_name: str | None = None
    product_category: str | None = None
    duration_type: str | None = None
    last_scan_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True, extra="forbid")


class TicketAttendeeSnapshot(BaseModel):
    """Minimal attendee data embedded in a TicketPublic response."""

    id: uuid.UUID
    name: str
    email: str | None = None
    category: str | None = None

    model_config = ConfigDict(from_attributes=True)


class TicketProductSnapshot(BaseModel):
    """Minimal product data embedded in a TicketPublic response."""

    id: uuid.UUID
    name: str
    price: float
    category: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class TicketPublic(BaseModel):
    """Full public representation of a single ticket (AttendeeProducts row).

    Returned by POST /attendees/check-in/{code}.
    Embeds attendee + product snapshots for scanner UIs without extra round-trips.
    Enriched with scan summary fields from ticket_events so frontend/staff can
    apply check-in policy at runtime (single-scan, scan-every-time, etc.).
    """

    id: uuid.UUID
    check_in_code: str
    payment_id: uuid.UUID | None = None
    attendee: TicketAttendeeSnapshot
    product: TicketProductSnapshot
    # Scan summary — populated by POST /attendees/check-in/{code} from ticket_events.
    # Re-scan can be derived by the frontend as `total_scans > 1`.
    total_scans: int = 0
    first_scan_at: datetime | None = None
    last_scan_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class TicketProduct(BaseModel):
    """Minimal product data for tickets."""

    name: str
    category: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    quantity: int = 1


class AttendeeWithTickets(BaseModel):
    """Attendee with ticket/product information."""

    id: uuid.UUID
    name: str
    email: str | None
    category: str | None = None
    check_in_code: str | None = None
    popup_id: uuid.UUID
    popup_name: str
    popup_slug: str | None = None
    products: list[TicketProduct]


class AttendeeWithOriginPublic(AttendeePublic):
    """Attendee response with an origin discriminator field.

    Used by GET /attendees/my/popup/{popup_id} and related human-scoped
    endpoints. Extends AttendeePublic with:
    - products: list of AttendeeProductPublic items (overwrites the base Any list)
    - origin: "application" when application_id IS NOT NULL, "direct_sale" otherwise

    The origin is set by the router after fetching from the CRUD layer.
    """

    products: list[AttendeeProductPublic] = []
    origin: str = (
        ""  # "application" | "direct_sale" — set by router after model_validate
    )


class AttendeeListItem(AttendeeBase):
    """Attendee schema for the list endpoint (GET /attendees).

    Uses ProductWithQuantity for the products field to preserve the legacy
    shape returned by the list endpoint. Use AttendeePublic for detail views
    where AttendeeProductPublic (with check_in_code) is needed.
    """

    id: uuid.UUID
    category: str | None = None  # derived from category_id FK via ORM property
    created_at: datetime | None = None
    updated_at: datetime | None = None
    products: list[ProductWithQuantity] = []
    human_id: uuid.UUID | None = None

    model_config = ConfigDict(from_attributes=True)


class AttendeePurchases(BaseModel):
    """Purchased products grouped by attendee."""

    attendee_id: uuid.UUID
    attendee_name: str
    attendee_category: str
    products: list[ProductWithQuantity] = []

    model_config = ConfigDict(from_attributes=True)
