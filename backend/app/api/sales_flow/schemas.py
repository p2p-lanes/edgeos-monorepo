import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import Boolean, Column, Integer, Numeric
from sqlmodel import Field, SQLModel, String

from app.api.shared.enums import ApplicationLayout


class SalesFlowType(StrEnum):
    """Sale model of a flow. Mirrors PopupBase.sale_type plus 'upsale'."""

    application = "application"
    direct = "direct"
    upsale = "upsale"


class SalesFlowVisibility(StrEnum):
    """Listing-only switch (Design D-URL): never affects access, only whether
    the flow appears in the portal's flow listing for its popup."""

    portal_listed = "portal_listed"
    direct_url_only = "direct_url_only"


class SalesFlowReviewersMode(StrEnum):
    """Whether a flow uses the popup-level reviewer list or its own (D4)."""

    inherit = "inherit"
    override = "override"


class SalesFlowIdentityMode(StrEnum):
    """portal_auth is the only implemented mode in v1; anonymous is reserved
    for a future ticket-code lookup flow (spec: upsale-flow)."""

    portal_auth = "portal_auth"
    anonymous = "anonymous"


# Reserved portal path segments a flow slug must never collide with.
# portal/src/app/checkout/[popupSlug]/thank-you/page.tsx is a static Next.js
# segment and always wins routing priority over a dynamic [flowSlug] segment,
# so a flow with either slug would be permanently unreachable.
RESERVED_FLOW_SLUGS = frozenset({"thank-you", "success"})


def validate_flow_slug(value: str) -> str:
    """Reject reserved slugs. Raises ValueError -> 422 via pydantic."""
    if value in RESERVED_FLOW_SLUGS:
        raise ValueError(
            f"'{value}' is a reserved slug and cannot be used for a sales flow"
        )
    return value


class SalesFlowBase(SQLModel):
    """Class A (flow identity) + Class B (inheritable override) columns.

    Design: sdd/sales-flows D1 — every Class B column is NULLABLE; NULL means
    "read the popup column of the same name". They are NOT NULL on
    PopupBase — nullability here is the whole point.
    """

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)

    # --- Class A: flow identity (NOT NULL, no fallback) ---
    type: SalesFlowType = Field(
        default=SalesFlowType.application,
        sa_column=Column(String, nullable=False, server_default="application"),
    )
    slug: str = Field(index=True)
    name: str
    visibility: SalesFlowVisibility = Field(
        default=SalesFlowVisibility.portal_listed,
        sa_column=Column(String, nullable=False, server_default="portal_listed"),
    )
    is_default: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    order: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, server_default="0"),
    )
    reviewers_mode: SalesFlowReviewersMode = Field(
        default=SalesFlowReviewersMode.inherit,
        sa_column=Column(String, nullable=False, server_default="inherit"),
    )
    identity_mode: SalesFlowIdentityMode = Field(
        default=SalesFlowIdentityMode.portal_auth,
        sa_column=Column(String, nullable=False, server_default="portal_auth"),
    )

    # --- Class C: flow-only, reserved. Always NULL in v1 (G0 #5) — the flow
    # inherits popup.status until a later change activates this column. ---
    status: str | None = Field(default=None, nullable=True)

    # --- Class B: inheritable override (all NULLABLE — NULL = inherit popup) ---
    application_layout: ApplicationLayout | None = Field(default=None, nullable=True)
    requires_application_fee: bool | None = Field(default=None, nullable=True)
    application_fee_amount: Decimal | None = Field(
        default=None, sa_column=Column(Numeric(10, 2), nullable=True)
    )
    allows_scholarship: bool | None = Field(default=None, nullable=True)
    allows_incentive: bool | None = Field(default=None, nullable=True)
    allows_coupons: bool | None = Field(default=None, nullable=True)
    open_checkout_success_url: str | None = Field(default=None, nullable=True)
    open_checkout_cancel_url: str | None = Field(default=None, nullable=True)
    open_checkout_signing_secret: str | None = Field(default=None, nullable=True)
    abandoned_cart_delay_days: int | None = Field(default=None, nullable=True)
    abandoned_cart_repeat_days: int | None = Field(default=None, nullable=True)
    abandoned_cart_max_count: int | None = Field(default=None, nullable=True)
    purchase_reminder_delay_days: int | None = Field(default=None, nullable=True)
    purchase_reminder_repeat_days: int | None = Field(default=None, nullable=True)
    purchase_reminder_max_count: int | None = Field(default=None, nullable=True)
    abandoned_application_delay_days: int | None = Field(default=None, nullable=True)
    abandoned_application_repeat_days: int | None = Field(default=None, nullable=True)
    abandoned_application_max_count: int | None = Field(default=None, nullable=True)


class SalesFlowCreate(BaseModel):
    """Sales flow creation payload (BO). tenant_id is derived server-side."""

    popup_id: uuid.UUID
    type: SalesFlowType = SalesFlowType.application
    slug: str
    name: str
    visibility: SalesFlowVisibility = SalesFlowVisibility.portal_listed
    is_default: bool = False
    order: int = 0
    reviewers_mode: SalesFlowReviewersMode = SalesFlowReviewersMode.inherit
    identity_mode: SalesFlowIdentityMode = SalesFlowIdentityMode.portal_auth
    application_layout: ApplicationLayout | None = None
    requires_application_fee: bool | None = None
    application_fee_amount: Decimal | None = None
    allows_scholarship: bool | None = None
    allows_incentive: bool | None = None
    allows_coupons: bool | None = None
    open_checkout_success_url: str | None = None
    open_checkout_cancel_url: str | None = None
    open_checkout_signing_secret: str | None = None
    abandoned_cart_delay_days: int | None = None
    abandoned_cart_repeat_days: int | None = None
    abandoned_cart_max_count: int | None = None
    purchase_reminder_delay_days: int | None = None
    purchase_reminder_repeat_days: int | None = None
    purchase_reminder_max_count: int | None = None
    abandoned_application_delay_days: int | None = None
    abandoned_application_repeat_days: int | None = None
    abandoned_application_max_count: int | None = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        return validate_flow_slug(v)

    model_config = ConfigDict(str_strip_whitespace=True)


class SalesFlowUpdate(BaseModel):
    """Partial update payload (BO). Only provided fields are applied."""

    type: SalesFlowType | None = None
    slug: str | None = None
    name: str | None = None
    visibility: SalesFlowVisibility | None = None
    is_default: bool | None = None
    order: int | None = None
    reviewers_mode: SalesFlowReviewersMode | None = None
    identity_mode: SalesFlowIdentityMode | None = None
    application_layout: ApplicationLayout | None = None
    requires_application_fee: bool | None = None
    application_fee_amount: Decimal | None = None
    allows_scholarship: bool | None = None
    allows_incentive: bool | None = None
    allows_coupons: bool | None = None
    open_checkout_success_url: str | None = None
    open_checkout_cancel_url: str | None = None
    open_checkout_signing_secret: str | None = None
    abandoned_cart_delay_days: int | None = None
    abandoned_cart_repeat_days: int | None = None
    abandoned_cart_max_count: int | None = None
    purchase_reminder_delay_days: int | None = None
    purchase_reminder_repeat_days: int | None = None
    purchase_reminder_max_count: int | None = None
    abandoned_application_delay_days: int | None = None
    abandoned_application_repeat_days: int | None = None
    abandoned_application_max_count: int | None = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return validate_flow_slug(v)


class SalesFlowPublic(SalesFlowBase):
    """Sales flow schema for API responses."""

    id: uuid.UUID
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class FlowProductsBase(SQLModel):
    """Base schema for the flow_products link table.

    Near-verbatim GroupProductsBase (app/api/group/schemas.py). Empty product
    set for a flow means "all active popup products" (D3) — resolved in
    sales_flow/resolver.py, not represented here.
    """

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    flow_id: uuid.UUID = Field(foreign_key="sales_flows.id", primary_key=True)
    product_id: uuid.UUID = Field(
        foreign_key="products.id", primary_key=True, index=True
    )
