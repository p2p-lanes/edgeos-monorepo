import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import Numeric
from sqlmodel import Column, Field, SQLModel


class ProductCategory(str, Enum):
    """Product categories determining which fields are relevant."""

    TICKET = "ticket"
    HOUSING = "housing"
    MERCH = "merch"
    OTHER = "other"


class TicketDuration(str, Enum):
    """Duration types for ticket products."""

    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    FULL = "full"


class TicketAttendeeCategory(str, Enum):
    """Attendee categories for ticket products."""

    MAIN = "main"
    SPOUSE = "spouse"
    KID = "kid"


class ProductBase(SQLModel):
    """Base product schema with fields shared across all product schemas."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    name: str = Field(index=True)
    slug: str = Field(index=True)
    price: Decimal = Field(sa_column=Column(Numeric(10, 2), nullable=False))
    compare_price: Decimal | None = Field(
        default=None, sa_column=Column(Numeric(10, 2), nullable=True)
    )
    description: str | None = Field(default=None, nullable=True)
    category: ProductCategory = Field(default=ProductCategory.TICKET, index=True)
    attendee_category: TicketAttendeeCategory | None = Field(
        default=None, nullable=True
    )
    duration_type: TicketDuration | None = Field(default=None, nullable=True)
    start_date: datetime | None = Field(default=None, nullable=True)
    end_date: datetime | None = Field(default=None, nullable=True)
    is_active: bool = Field(default=True)
    exclusive: bool = Field(default=False)


class ProductPublic(ProductBase):
    """Product schema for API responses."""

    id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


class ProductCreate(BaseModel):
    """Product schema for creation."""

    popup_id: uuid.UUID
    name: str
    slug: str | None = None
    price: Decimal
    compare_price: Decimal | None = None
    description: str | None = None
    category: ProductCategory = ProductCategory.TICKET
    attendee_category: TicketAttendeeCategory | None = None
    duration_type: TicketDuration | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    is_active: bool = True
    exclusive: bool = False

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_ticket_fields(self) -> "ProductCreate":
        """Validate that ticket-specific fields are only set for tickets."""
        if self.category != ProductCategory.TICKET:
            if self.attendee_category is not None:
                raise ValueError(
                    "attendee_category can only be set for ticket products"
                )
            if self.duration_type is not None:
                raise ValueError("duration_type can only be set for ticket products")
        return self


class ProductUpdate(BaseModel):
    """Product schema for updates."""

    name: str | None = None
    slug: str | None = None
    price: Decimal | None = None
    compare_price: Decimal | None = None
    description: str | None = None
    category: ProductCategory | None = None
    attendee_category: TicketAttendeeCategory | None = None
    duration_type: TicketDuration | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    is_active: bool | None = None
    exclusive: bool | None = None


class ProductWithQuantity(ProductPublic):
    """Product with quantity for attendee products."""

    quantity: int = 1
