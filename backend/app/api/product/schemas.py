import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import Boolean, Numeric, Text
from sqlmodel import Column, DateTime, Field, SQLModel


# ProductCategory is now a free-form string so admins can create custom categories.
# Known built-in values are listed below for reference.
ProductCategory = str
CATEGORY_TICKET: ProductCategory = "ticket"
CATEGORY_HOUSING: ProductCategory = "housing"
CATEGORY_MERCH: ProductCategory = "merch"
CATEGORY_OTHER: ProductCategory = "other"
CATEGORY_PATREON: ProductCategory = "patreon"
KNOWN_PRODUCT_CATEGORIES = [CATEGORY_TICKET, CATEGORY_HOUSING, CATEGORY_MERCH, CATEGORY_OTHER, CATEGORY_PATREON]


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
    description: str | None = Field(default=None, nullable=True, sa_type=Text())
    image_url: str | None = Field(default=None, nullable=True)
    category: str = Field(default="ticket", index=True)
    attendee_category: TicketAttendeeCategory | None = Field(
        default=None, nullable=True
    )
    duration_type: TicketDuration | None = Field(default=None, nullable=True)
    start_date: datetime | None = Field(
        default=None, nullable=True, sa_type=DateTime(timezone=True)
    )
    end_date: datetime | None = Field(
        default=None, nullable=True, sa_type=DateTime(timezone=True)
    )
    is_active: bool = Field(default=True)
    exclusive: bool = Field(default=False)
    max_quantity: int | None = Field(default=None, nullable=True)
    insurance_eligible: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )


class ProductPublic(ProductBase):
    """Product schema for API responses."""

    id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


class ProductCreate(BaseModel):
    """Product schema for creation."""

    popup_id: uuid.UUID
    name: str
    slug: str | None = None
    price: Decimal = Field(ge=0)
    compare_price: Decimal | None = Field(default=None, ge=0)
    description: str | None = None
    image_url: str | None = None
    category: str = "ticket"
    attendee_category: TicketAttendeeCategory | None = None
    duration_type: TicketDuration | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    is_active: bool = True
    exclusive: bool = False
    max_quantity: int | None = None
    insurance_eligible: bool = False

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_ticket_fields(self) -> "ProductCreate":
        """Validate that ticket-specific fields are only set for tickets."""
        if self.category != "ticket":
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
    price: Decimal | None = Field(default=None, ge=0)
    compare_price: Decimal | None = Field(default=None, ge=0)
    description: str | None = None
    image_url: str | None = None
    category: str | None = None
    attendee_category: TicketAttendeeCategory | None = None
    duration_type: TicketDuration | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    is_active: bool | None = None
    exclusive: bool | None = None
    max_quantity: int | None = None
    insurance_eligible: bool | None = None


class ProductBatchItem(BaseModel):
    """Single product in a batch import (popup_id is top-level)."""

    name: str
    slug: str | None = None
    price: Decimal = Field(ge=0)
    compare_price: Decimal | None = Field(default=None, ge=0)
    description: str | None = None
    image_url: str | None = None
    category: str = "ticket"
    attendee_category: TicketAttendeeCategory | None = None
    duration_type: TicketDuration | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    is_active: bool = True
    exclusive: bool = False
    max_quantity: int | None = None
    insurance_eligible: bool = False

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def validate_ticket_fields(self) -> "ProductBatchItem":
        """Validate that ticket-specific fields are only set for tickets."""
        if self.category != "ticket":
            if self.attendee_category is not None:
                raise ValueError(
                    "attendee_category can only be set for ticket products"
                )
            if self.duration_type is not None:
                raise ValueError("duration_type can only be set for ticket products")
        return self


class ProductBatch(BaseModel):
    """Schema for batch product creation."""

    popup_id: uuid.UUID
    products: list[ProductBatchItem]


class ProductBatchResult(ProductPublic):
    """Schema for batch product result."""

    success: bool
    err_msg: str | None = None
    row_number: int


class ProductWithQuantity(ProductPublic):
    """Product with quantity for attendee products."""

    quantity: int = 1
