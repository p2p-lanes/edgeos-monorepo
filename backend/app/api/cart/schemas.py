import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr
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


class CartItemMealPlan(BaseModel):
    """Meal-plan selection in cart (one row per attendee × weekly product).

    All metadata fields are nullable in cart because the buyer fills them
    incrementally — completeness is enforced only at checkout submission.

    `daily_choices` maps ISO weekday dates (YYYY-MM-DD) to menu_option keys
    (or the literal "chef" for chef's choice). `dietary_restriction` and
    `special_request` apply at the attendee level — the frontend / reducer
    keeps them in sync across every meal_plans entry for that attendee.
    """

    attendee_id: str
    product_id: str
    daily_choices: dict[str, str] | None = None
    dietary_restriction: str | None = None
    special_request: str | None = None


class CartState(BaseModel):
    """Full cart state stored as JSONB."""

    passes: list[CartItemPass] = []
    housing: CartItemHousing | None = None
    merch: list[CartItemMerch] = []
    patron: CartItemPatron | None = None
    meal_plans: list[CartItemMealPlan] = []
    promo_code: str | None = None
    insurance: bool = False
    current_step: str | None = None


class CartBase(SQLModel):
    """Base cart schema."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    # Nullable for anonymous open-checkout carts (no logged-in human). The
    # authenticated portal flow always sets it.
    human_id: uuid.UUID | None = Field(
        default=None, foreign_key="humans.id", index=True
    )
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    # Set only for anonymous open-checkout carts, which are keyed by email
    # instead of a human. Stored in clear so backoffice can show it in the
    # abandoned-cart list. Authenticated carts read the email from the human.
    email: str | None = Field(default=None, index=True)
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


class OpenCartUpsert(BaseModel):
    """Anonymous open-checkout cart upsert request (keyed by email)."""

    email: EmailStr
    items: CartState


class OpenCartPublic(BaseModel):
    """Anonymous open-checkout cart response.

    `restore_token` is the HMAC for the signed restore link
    (GET /checkout/{slug}/cart?cid=<id>&sig=<restore_token>). It is only
    present when the popup configures an open_checkout_signing_secret; the
    client stores it to rebuild the cart on a later visit.
    """

    id: uuid.UUID
    popup_id: uuid.UUID
    email: str
    items: CartState
    restore_token: str | None = None
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
    # Buyer email. Taken from the human for authenticated carts, or from the
    # cart row for anonymous open-checkout carts (which have no human).
    email: str | None = None
    # Null for anonymous open-checkout carts (no logged-in human).
    human: CartHumanInfo | None = None
    popup: CartPopupInfo
    payments: list[CartPaymentInfo] = []

    model_config = ConfigDict(from_attributes=True)
