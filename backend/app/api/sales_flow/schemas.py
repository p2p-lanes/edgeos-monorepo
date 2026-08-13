import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from sqlalchemy import Boolean, Column, Integer, Numeric
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel, String

from app.api.shared.enums import ApplicationLayout, InstallmentInterval
from app.services.restrictions.schemas import (
    assert_restriction_rule_allowed_for_type,
    parse_restriction_rule,
)


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

    # --- Class C: flow-only. NULL = restrictions feature off (design D5/D6,
    # G3 checkpoint 12.8 CONFIRMED 2026-08-04). Closed AND/OR predicate tree
    # over {form_answer, human_profile_field, has_product} — see
    # `app/services/restrictions/schemas.py`. Never an expression language;
    # adding a fourth predicate is a future SDD change, not configuration. ---
    restriction_rule: dict | None = Field(
        default=None, sa_column=Column(JSONB, nullable=True)
    )

    # How this flow's checkout looks (sdd/sales-flows-rediseno). Copied from
    # the popup when the flow is created, and read only from here after
    # that. NULL means "no overrides", never "ask the popup" — that
    # read-through is the shape this redesign removed everywhere else.
    theme_config: dict | None = Field(
        default=None, sa_column=Column(JSONB, nullable=True)
    )

    # --- Class B: inheritable override (all NULLABLE — NULL = inherit popup) ---
    application_layout: ApplicationLayout | None = Field(default=None, nullable=True)
    requires_application_fee: bool | None = Field(default=None, nullable=True)
    application_fee_amount: Decimal | None = Field(
        default=None, sa_column=Column(Numeric(10, 2), nullable=True)
    )
    allows_scholarship: bool | None = Field(default=None, nullable=True)
    allows_incentive: bool | None = Field(default=None, nullable=True)
    allows_coupons: bool | None = Field(default=None, nullable=True)
    # Fees charged at this flow's checkout. A door that sells to volunteers
    # does not add a contribution to their order just because the general
    # one does.
    insurance_enabled: bool | None = Field(default=None, nullable=True)
    insurance_percentage: Decimal | None = Field(
        default=None, sa_column=Column(Numeric(5, 2), nullable=True)
    )
    contribution_enabled: bool | None = Field(default=None, nullable=True)
    contribution_percentage: Decimal | None = Field(
        default=None, sa_column=Column(Numeric(5, 2), nullable=True)
    )
    contribution_label: str | None = Field(default=None, nullable=True)
    contribution_description: str | None = Field(default=None, nullable=True)
    # Payment terms offered at this flow's checkout. All nullable, unlike the
    # popup's NOT NULL originals: a flow that says nothing about installments
    # offers none, which is what a Class B column with no value has always
    # meant here.
    installments_enabled: bool | None = Field(default=None, nullable=True)
    installments_deadline: datetime | None = Field(default=None, nullable=True)
    installments_max: int | None = Field(default=None, nullable=True)
    installments_interval: InstallmentInterval | None = Field(
        default=None, sa_column=Column(String, nullable=True)
    )
    installments_interval_count: int | None = Field(default=None, nullable=True)
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
    insurance_enabled: bool | None = None
    insurance_percentage: Decimal | None = None
    contribution_enabled: bool | None = None
    contribution_percentage: Decimal | None = None
    contribution_label: str | None = None
    contribution_description: str | None = None
    installments_enabled: bool | None = None
    installments_deadline: datetime | None = None
    installments_max: int | None = None
    installments_interval: InstallmentInterval | None = None
    installments_interval_count: int | None = None
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
    restriction_rule: dict | None = None
    theme_config: dict | None = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        return validate_flow_slug(v)

    @field_validator("restriction_rule")
    @classmethod
    def validate_restriction_rule_shape(cls, v: dict | None) -> dict | None:
        if v is None:
            return v
        parse_restriction_rule(v)  # raises ValueError -> 422 on any bad shape
        return v

    @model_validator(mode="after")
    def validate_restriction_rule_for_type(self) -> "SalesFlowCreate":
        assert_restriction_rule_allowed_for_type(
            self.restriction_rule, flow_type=self.type.value
        )
        return self

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
    insurance_enabled: bool | None = None
    insurance_percentage: Decimal | None = None
    contribution_enabled: bool | None = None
    contribution_percentage: Decimal | None = None
    contribution_label: str | None = None
    contribution_description: str | None = None
    installments_enabled: bool | None = None
    installments_deadline: datetime | None = None
    installments_max: int | None = None
    installments_interval: InstallmentInterval | None = None
    installments_interval_count: int | None = None
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
    restriction_rule: dict | None = None
    theme_config: dict | None = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return validate_flow_slug(v)

    @field_validator("restriction_rule")
    @classmethod
    def validate_restriction_rule_shape(cls, v: dict | None) -> dict | None:
        if v is None:
            return v
        parse_restriction_rule(v)  # raises ValueError -> 422 on any bad shape
        return v


class SalesFlowPublic(SalesFlowBase):
    """Sales flow schema for API responses."""

    id: uuid.UUID
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class SalesFlowReadiness(BaseModel):
    """What a flow is missing before it can sell
    (sdd/sales-flows-rediseno slice 8).

    `blockers` and `warnings` carry machine codes, not sentences. The
    backoffice owns the wording, and a code that nobody renders yet is
    still a code the API can add without breaking a client.
    """

    flow_id: uuid.UUID
    enabled_step_count: int
    offered_product_count: int
    form_field_count: int
    has_approval_strategy: bool
    blockers: list[str]
    warnings: list[str]


# Class B (inheritable override) column names — must exactly match both
# SalesFlowBase and PopupBase field names (same names by construction, see
# design D1/D2). Single source of truth for `build_effective_config`
# (sales_flow/resolver.py) and its NULL-matrix unit tests.
EFFECTIVE_CONFIG_FIELDS: tuple[str, ...] = (
    "application_layout",
    "requires_application_fee",
    "application_fee_amount",
    "allows_scholarship",
    "allows_incentive",
    "allows_coupons",
    "insurance_enabled",
    "insurance_percentage",
    "contribution_enabled",
    "contribution_percentage",
    "contribution_label",
    "contribution_description",
    "installments_enabled",
    "installments_deadline",
    "installments_max",
    "installments_interval",
    "installments_interval_count",
    "open_checkout_success_url",
    "open_checkout_cancel_url",
    "open_checkout_signing_secret",
    "abandoned_cart_delay_days",
    "abandoned_cart_repeat_days",
    "abandoned_cart_max_count",
    "purchase_reminder_delay_days",
    "purchase_reminder_repeat_days",
    "purchase_reminder_max_count",
    "abandoned_application_delay_days",
    "abandoned_application_repeat_days",
    "abandoned_application_max_count",
)


class EffectiveFlowConfig(BaseModel):
    """A flow's own channel configuration.

    Since sdd/sales-flows-rediseno slice 7 these columns belong to the
    flow: seeded from the popup when the flow is created, read straight
    from the flow afterwards. Every field is optional because a flow really
    can have none set — a transient flow in a test, or one created through
    a path that predates the seeding. Saying so here is what stops a
    missing value being quietly replaced by someone else's.

    Slice 9 decision (design's "Open Questions" left this shape open):
    this is a **sibling** object, never merged into `PopupPublic`. It is
    built by `sales_flow/resolver.py::build_effective_config` and consumed
    internally by the cutover slices that actually read these columns
    through the flow (email tier resolution — slice 10, coupon allowance —
    slice 11, reminder cadence — slice 10). No API response serializes this
    in slice 9: no consumer needs it publicly yet, and inventing an unused
    public surface would be scope creep on top of the URL/resolver work
    this slice is actually chartered to deliver.
    """

    application_layout: ApplicationLayout | None = None
    requires_application_fee: bool | None = None
    application_fee_amount: Decimal | None = None
    allows_scholarship: bool | None = None
    allows_incentive: bool | None = None
    allows_coupons: bool | None = None
    insurance_enabled: bool | None = None
    insurance_percentage: Decimal | None = None
    contribution_enabled: bool | None = None
    contribution_percentage: Decimal | None = None
    contribution_label: str | None = None
    contribution_description: str | None = None
    installments_enabled: bool | None = None
    installments_deadline: datetime | None = None
    installments_max: int | None = None
    installments_interval: InstallmentInterval | None = None
    installments_interval_count: int | None = None
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
