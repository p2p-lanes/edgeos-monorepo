import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, Field, SQLModel


class CartItemPass(BaseModel):
    """Pass selection in cart."""

    attendee_id: str
    product_id: str
    quantity: int = 1


class CartItemHousing(BaseModel):
    """Housing selection in cart."""

    product_id: str
    check_in: str
    check_out: str


class CartItemMerch(BaseModel):
    """Merch selection in cart."""

    product_id: str
    quantity: int = 1


class CartItemPatron(BaseModel):
    """Patron selection in cart."""

    product_id: str
    amount: float
    is_custom_amount: bool = False


class CartState(BaseModel):
    """Full cart state stored as JSONB."""

    passes: list[CartItemPass] = []
    housing: CartItemHousing | None = None
    merch: list[CartItemMerch] = []
    patron: CartItemPatron | None = None
    promo_code: str | None = None
    insurance: bool = False


class CartBase(SQLModel):
    """Base cart schema."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    human_id: uuid.UUID = Field(foreign_key="humans.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    items: dict = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default="{}"),
    )


class CartUpdate(BaseModel):
    """Schema for updating cart items."""

    items: CartState


class CartPublic(BaseModel):
    """Cart schema for API responses."""

    id: uuid.UUID
    human_id: uuid.UUID
    popup_id: uuid.UUID
    items: CartState
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class CartHumanInfo(BaseModel):
    """Embedded human info for abandoned cart listing."""

    id: uuid.UUID
    email: str
    first_name: str | None = None
    last_name: str | None = None


class CartPopupInfo(BaseModel):
    """Embedded popup info for abandoned cart listing."""

    id: uuid.UUID
    name: str
    slug: str


class CartPaymentInfo(BaseModel):
    """Embedded payment info for abandoned cart listing."""

    id: uuid.UUID
    status: str
    amount: float
    currency: str
    created_at: datetime | None = None


class AbandonedCartPublic(BaseModel):
    """Abandoned cart with enriched info for backoffice."""

    id: uuid.UUID
    items: CartState
    created_at: datetime | None = None
    updated_at: datetime | None = None
    human: CartHumanInfo
    popup: CartPopupInfo
    payments: list[CartPaymentInfo] = []

    model_config = ConfigDict(from_attributes=True)
