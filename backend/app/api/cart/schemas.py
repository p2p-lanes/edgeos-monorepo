import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator, model_validator
from pydantic import Field as PydanticField
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, Field, SQLModel

from app.api.payment.schemas import PaymentRecipientRequest


class CartAssignmentBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CartUnassigned(CartAssignmentBase):
    kind: Literal["unassigned"]


class CartAttendeeAssignment(CartAssignmentBase):
    kind: Literal["attendee"]
    attendee_id: str = PydanticField(min_length=1)


class CartRecipientAssignment(CartAssignmentBase):
    kind: Literal["recipient"]
    recipient_key: str = PydanticField(min_length=1, max_length=255)


CartAssignment = Annotated[
    CartUnassigned | CartAttendeeAssignment | CartRecipientAssignment,
    PydanticField(discriminator="kind"),
]


class CartLineBase(BaseModel):
    """Fields shared by every purchase-intent line."""

    assignment: CartAssignment
    step_type: str | None = PydanticField(default=None, min_length=1)

    model_config = ConfigDict(extra="forbid")


class CartProductLine(CartLineBase):
    """A fixed-price product selection, assigned or unassigned."""

    kind: Literal["product"]
    product_id: str = PydanticField(min_length=1)
    quantity: int = PydanticField(default=1, ge=1)
    # Display snapshot carried by legacy dynamic items. Quote and payment code
    # always resolve the authoritative product price and never trust this value.
    price: float | None = PydanticField(default=None, ge=0)


class CartDateRangeLine(CartLineBase):
    """A product selected for a date range, such as legacy housing."""

    kind: Literal["date_range"]
    product_id: str = PydanticField(min_length=1)
    check_in: date
    check_out: date
    quantity: int = PydanticField(default=1, ge=1)


class CartCustomAmountLine(CartLineBase):
    """A product whose unit price is chosen during checkout."""

    kind: Literal["custom_amount"]
    product_id: str = PydanticField(min_length=1)
    amount: float = PydanticField(ge=0)
    is_custom_amount: bool = False


class CartMealPlanLine(CartLineBase):
    """Meal-plan selection in cart (one row per attendee × weekly product).

    All metadata fields are nullable in cart because the buyer fills them
    incrementally — completeness is enforced only at checkout submission.

    `daily_choices` maps ISO weekday dates (YYYY-MM-DD) to menu_option keys
    (or the literal "chef" for chef's choice). `dietary_restriction` and
    `special_request` apply at the attendee level — the frontend / reducer
    keeps them in sync across every meal_plans entry for that attendee.
    """

    kind: Literal["meal_plan"]
    product_id: str = PydanticField(min_length=1)
    daily_choices: dict[str, str] | None = None
    dietary_restriction: str | None = None
    special_request: str | None = None


class CartGuest(BaseModel):
    """One occupant as the cart holds them.

    ``name`` may be empty: the checkout renders a slot per guest before any of
    them is filled in, and half a party typed in is exactly what a saved cart
    is for. ``answers`` holds whatever else the step's guest form asked, keyed
    by its field keys.
    """

    name: str = ""
    answers: dict[str, Any] = PydanticField(default_factory=dict)


class CartAccommodationLine(CartLineBase):
    """A room the buyer picked, as it survives a page reload.

    Keyed by ``accommodation_id`` rather than by the shadow ``product_id``:
    the product is an implementation detail of how the booking travels
    through payments, and resolving it at purchase time means a cart saved
    before a room was re-synced still points at the right room.
    """

    kind: Literal["accommodation"]
    accommodation_id: str = PydanticField(min_length=1)
    check_in: date
    check_out: date
    guest_count: int | None = PydanticField(default=None, ge=1)
    guests: list[CartGuest] = PydanticField(default_factory=list)
    #: Answers from whoever the room is for. Per-guest answers live on each
    #: entry of ``guests``.
    booker_answers: dict[str, Any] = PydanticField(default_factory=dict)

    @field_validator("guests", mode="before")
    @classmethod
    def _lift_bare_names(cls, value: Any) -> Any:
        """Accept the shape carts used before guests had answers.

        Guests were a list of names. There are carts saved with that shape and
        a 422 on reopening the checkout is worse than this feature is good, so
        a bare string is read as a guest with that name and nothing else.
        """
        if not isinstance(value, list):
            return value
        return [{"name": item} if isinstance(item, str) else item for item in value]


CartLine = Annotated[
    CartProductLine
    | CartDateRangeLine
    | CartCustomAmountLine
    | CartMealPlanLine
    | CartAccommodationLine,
    PydanticField(discriminator="kind"),
]


class CartState(BaseModel):
    """Full cart state stored as JSONB."""

    lines: list[CartLine] = PydanticField(default_factory=list)
    recipients: list[PaymentRecipientRequest] = PydanticField(default_factory=list)
    promo_code: str | None = None
    insurance: bool = False
    current_step: str | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_recipients(self) -> "CartState":
        keys = [recipient.recipient_key for recipient in self.recipients]
        if len(keys) != len(set(keys)):
            raise ValueError("recipient_key values must be unique")
        referenced = {
            line.assignment.recipient_key
            for line in self.lines
            if isinstance(line.assignment, CartRecipientAssignment)
        }
        if referenced - set(keys):
            raise ValueError("Every recipient_key must reference a supplied recipient")
        return self


class CartBase(SQLModel):
    """Base cart schema."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    # Nullable for anonymous open-checkout carts (no logged-in human). The
    # authenticated portal flow always sets it.
    human_id: uuid.UUID | None = Field(
        default=None, foreign_key="humans.id", index=True
    )
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    sales_flow_id: uuid.UUID | None = Field(
        default=None, foreign_key="sales_flows.id", index=True
    )
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
    (GET /checkout/{slug}/{flow_slug}/cart?cid=<id>&sig=<restore_token>). It is only
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
