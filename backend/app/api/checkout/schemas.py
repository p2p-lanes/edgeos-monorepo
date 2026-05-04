"""Schemas for the open-ticketing checkout API (CAP-A, CAP-B, CAP-C, CAP-D)."""

import uuid
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from app.api.popup.schemas import PopupPublic
from app.api.product.schemas import TierGroupPublic, TierPhasePublic
from app.api.ticketing_step.schemas import TicketingStepPublic


# ---------------------------------------------------------------------------
# Runtime schemas (GET /checkout/{slug}/runtime)
# ---------------------------------------------------------------------------


class CheckoutBuyerField(BaseModel):
    """Public buyer-form field for the checkout runtime."""

    id: uuid.UUID
    name: str
    label: str
    field_type: str
    required: bool = False
    options: list[str] | None = None
    placeholder: str | None = None
    help_text: str | None = None
    min_date: str | None = None
    max_date: str | None = None
    position: int = 0

    model_config = ConfigDict(from_attributes=True)


class CheckoutBuyerSection(BaseModel):
    """Public buyer-form section for the checkout runtime."""

    id: uuid.UUID
    label: str
    description: str | None = None
    order: int = 0
    kind: str = "standard"
    form_fields: list[CheckoutBuyerField] = []

    model_config = ConfigDict(from_attributes=True)


class CheckoutRuntimeProduct(BaseModel):
    """Public product available in the checkout runtime."""

    tenant_id: uuid.UUID
    popup_id: uuid.UUID
    id: uuid.UUID
    name: str
    slug: str
    description: str | None = None
    price: Decimal
    compare_price: Decimal | None = None
    image_url: str | None = None
    category: str = "ticket"
    currency: str = "USD"
    attendee_category: str | None = None
    duration_type: str | None = None
    start_date: Any | None = None
    end_date: Any | None = None
    max_quantity: int | None = None
    is_active: bool = True
    exclusive: bool = False
    insurance_eligible: bool = False
    tier_group: TierGroupPublic | None = None
    phase: TierPhasePublic | None = None

    model_config = ConfigDict(from_attributes=True)


class CheckoutRuntimeResponse(BaseModel):
    """Full response for GET /checkout/{slug}/runtime."""

    popup: PopupPublic
    products: list[CheckoutRuntimeProduct]
    buyer_form: list[CheckoutBuyerSection]
    ticketing_steps: list[TicketingStepPublic]
    form_schema: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Purchase schemas (POST /checkout/{slug}/purchase)
# ---------------------------------------------------------------------------


class ProductLine(BaseModel):
    """A single product + quantity in an open-ticketing purchase request."""

    product_id: uuid.UUID
    quantity: int = Field(ge=1, default=1)


class BuyerInfo(BaseModel):
    """Buyer identification and form data for open-ticketing purchase."""

    email: EmailStr
    first_name: str
    last_name: str
    form_data: dict[str, Any] = {}


class OpenTicketingPurchaseCreate(BaseModel):
    """Request schema for POST /checkout/{slug}/purchase."""

    products: list[ProductLine] = Field(min_length=1)
    buyer: BuyerInfo
    coupon_code: str | None = None


class OpenTicketingPurchaseResponse(BaseModel):
    """Response schema for POST /checkout/{slug}/purchase."""

    payment_id: uuid.UUID
    status: str
    checkout_url: str
    amount: Decimal
    currency: str
