"""Schemas for the open-ticketing checkout API (CAP-A, CAP-B, CAP-C, CAP-D)."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.api.attendee_category.schemas import AttendeeCategoryPublic
from app.api.popup.schemas import PopupPublic
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
    images: list[str] = []
    category: str = "ticket"
    currency: str = "USD"
    attendee_category: str | None = None
    duration_type: str | None = None
    start_date: Any | None = None
    end_date: Any | None = None
    # Full datetime instants (UTC) — the sale window can carry a precise cutoff
    # (e.g. "Friday 11:59 PM"). Clients render them in the popup's timezone.
    sale_starts_at: datetime | None = None
    sale_ends_at: datetime | None = None
    total_stock_cap: int | None = None
    total_stock_remaining: int | None = None
    max_per_order: int | None = None
    is_active: bool = True
    exclusive: bool = False
    insurance_eligible: bool = False

    model_config = ConfigDict(from_attributes=True)


class CheckoutRuntimeResponse(BaseModel):
    """Full response for GET /checkout/{slug}/runtime."""

    popup: PopupPublic
    products: list[CheckoutRuntimeProduct]
    buyer_form: list[CheckoutBuyerSection]
    ticketing_steps: list[TicketingStepPublic]
    # Per-popup attendee categories (benign config: keys, labels, sort order).
    # Shipped in the public bootstrap so anonymous checkout never has to call
    # the human-gated /portal/popups/{id}/attendee-categories endpoint.
    attendee_categories: list[AttendeeCategoryPublic] = []
    form_schema: dict[str, Any] | None = None


class CheckoutShareMeta(BaseModel):
    """Tiny, unauthenticated projection for social/OpenGraph share previews.

    Returned by the public ``/{slug}/share`` endpoint so social crawlers (which
    send no JWT) can render the popup name, tagline/location snippet and cover
    image without loading the full checkout runtime payload.
    """

    id: uuid.UUID
    name: str
    tagline: str | None = None
    location: str | None = None
    image_url: str | None = None


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


class Attribution(BaseModel):
    """Marketing attribution captured from the checkout entry URL.

    Generic (not partner-specific): any tenant running paid ads can use these.
    Persisted on the payment so an outbound purchase webhook can return them,
    which is how a partner ties the purchase back to its web session
    (``anonymous_id``). All fields optional; absent ones are dropped.
    """

    utm_source: str | None = Field(default=None, max_length=256)
    utm_medium: str | None = Field(default=None, max_length=256)
    utm_campaign: str | None = Field(default=None, max_length=256)
    utm_content: str | None = Field(default=None, max_length=256)
    fbclid: str | None = Field(default=None, max_length=512)
    landing_segment: str | None = Field(default=None, max_length=256)
    anonymous_id: str | None = Field(default=None, max_length=128)


class OpenTicketingPurchaseCreate(BaseModel):
    """Request schema for POST /checkout/{slug}/purchase."""

    products: list[ProductLine] = Field(min_length=1)
    buyer: BuyerInfo
    coupon_code: str | None = None
    # Buyer opt-in for the optional insurance fee (mirrors the authenticated
    # flow). Insurance is charged only when this is true and the popup enables
    # it; the amount is computed server-side from eligible products.
    insurance: bool = False
    fbc: str | None = Field(default=None, max_length=512)
    fbp: str | None = Field(default=None, max_length=512)
    # Active checkout language (from the entry URL ?lang=), used to build the
    # locale-aware success redirect. Falls back to the popup default when absent.
    locale: str | None = Field(default=None, max_length=8)
    attribution: Attribution | None = None
    # Cart continuity proof: signed cart identifier from the abandoned-cart
    # restore link (GET /checkout/{slug}/cart?cid=&sig=).  When both are
    # present and valid for this buyer+popup, the system is allowed to supersede
    # a prior PENDING payment.  Missing or invalid → supersede is blocked;
    # a 409 pending_payment_exists is returned if a PENDING payment exists.
    cid: uuid.UUID | None = None
    sig: str | None = None


class OpenTicketingPurchaseResponse(BaseModel):
    """Response schema for POST /checkout/{slug}/purchase."""

    payment_id: uuid.UUID
    status: str
    # SimpleFi-hosted checkout page where the buyer pays. Empty for the
    # zero-amount bypass (nothing to charge).
    checkout_url: str
    # Where the portal should send the buyer after a zero-amount approval that
    # bypassed SimpleFi, when the popup configures a custom open-checkout
    # success URL. Null for paid flows — SimpleFi performs that redirect itself.
    redirect_url: str | None = None
    amount: Decimal
    currency: str
