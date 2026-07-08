import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from sqlalchemy import Integer, Numeric, String, Text
from sqlalchemy.dialects import postgresql as pg
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, Field, SQLModel


class PaymentType(str, Enum):
    """Payment type — distinguishes pass purchases from application fees."""

    PASS_PURCHASE = "pass_purchase"
    APPLICATION_FEE = "application_fee"


class PaymentSource(str, Enum):
    """Settlement rail/provider shown to users.

    SIMPLEFI is the residual value: settlement webhooks that don't expose a
    card provider. CRYPTO is written at installment-plan activation, where
    the rail is explicit — so a plan with SIMPLEFI source predates that
    logic and its rail is unknown.
    """

    SIMPLEFI = "SimpleFI"
    STRIPE = "Stripe"
    MERCADOPAGO = "MercadoPago"
    CRYPTO = "Crypto"


class PaymentStatus(str, Enum):
    """Payment status."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class PaymentProductBase(SQLModel):
    """Base schema for payment product snapshot.

    UUID PK 'id' replaces the old composite PK (payment_id, product_id, attendee_id),
    allowing multiple rows with the same triple (needed when a buyer purchases N tickets
    of the same product in one payment — each gets its own PaymentProducts row).
    """

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            pg.UUID(as_uuid=True),
            primary_key=True,
        ),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    payment_id: uuid.UUID = Field(foreign_key="payments.id", index=True)
    product_id: uuid.UUID = Field(foreign_key="products.id", index=True)
    attendee_id: uuid.UUID = Field(foreign_key="attendees.id", index=True)
    quantity: int = Field(default=1)

    # Snapshot of product at time of purchase
    product_name: str
    product_description: str | None = Field(default=None, sa_type=Text())
    product_price: Decimal = Field(sa_column=Column(Numeric(10, 2), nullable=False))
    effective_unit_price: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 2), nullable=True),
    )
    product_category: str
    product_currency: str = Field(
        default="USD",
        sa_column=Column(String(3), nullable=False, server_default="USD"),
    )
    # Mirrors attendee_products.purchase_metadata. Captured at payment-creation
    # time so the SimpleFI-webhook approval path can propagate it when
    # materializing AttendeeProducts rows from this snapshot.
    purchase_metadata: dict | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )


class PaymentBase(SQLModel):
    """Base payment schema."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    application_id: uuid.UUID | None = Field(
        default=None, foreign_key="applications.id", index=True, nullable=True
    )
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    external_id: str | None = Field(default=None, nullable=True)
    status: str = Field(default=PaymentStatus.PENDING.value, index=True)
    amount: Decimal = Field(
        default=Decimal("0"), sa_column=Column(Numeric(10, 2), nullable=False)
    )
    # Total actually charged to the buyer, in the payment's fiat currency.
    # SimpleFi merchants can configure per-rail (card/crypto) price adjustments,
    # so this can differ from `amount` (the quoted total). NULL until settlement
    # and for non-SimpleFi payments — reporting reads COALESCE(amount_charged, amount).
    amount_charged: Decimal | None = Field(
        default=None, sa_column=Column(Numeric(10, 2), nullable=True)
    )
    insurance_amount: Decimal = Field(
        default=Decimal("0"),
        sa_column=Column(Numeric(10, 2), nullable=False, server_default="0"),
    )
    contribution_amount: Decimal = Field(
        default=Decimal("0"),
        sa_column=Column(Numeric(10, 2), nullable=False, server_default="0"),
    )
    currency: str = Field(default="USD")
    settlement_currency: str | None = Field(
        default=None,
        sa_column=Column(String(16), nullable=True),
    )
    rate: Decimal | None = Field(
        default=None, sa_column=Column(Numeric(18, 8), nullable=True)
    )
    source: str | None = Field(default=None, nullable=True)
    checkout_url: str | None = Field(default=None, nullable=True)
    buyer_snapshot: dict | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    # Discount tracking
    coupon_id: uuid.UUID | None = Field(
        default=None, foreign_key="coupons.id", nullable=True, index=True
    )
    coupon_code: str | None = Field(default=None, nullable=True)
    discount_value: Decimal | None = Field(
        default=None, sa_column=Column(Numeric(10, 2), nullable=True)
    )

    # Edit passes (for modifying existing purchases)
    edit_passes: bool = Field(default=False)

    # Installment plan tracking
    is_installment_plan: bool = Field(default=False)
    installments_total: int | None = Field(default=None, nullable=True)
    installments_paid: int | None = Field(
        default=0, sa_column=Column(Integer, nullable=True, server_default="0")
    )

    # Group discount tracking
    group_id: uuid.UUID | None = Field(
        default=None, foreign_key="groups.id", nullable=True, index=True
    )

    # Payment type
    payment_type: str = Field(default=PaymentType.PASS_PURCHASE.value)

    # Admin-grant attribution. Non-null only for $0 payments created by an
    # admin via the bulk-grant flow — distinguishes admin comps from organic
    # free payments (100% coupon, credit, etc.) which leave this NULL.
    granted_by_user_id: uuid.UUID | None = Field(
        default=None, foreign_key="users.id", nullable=True, index=True
    )

    # Credit deducted from application.credit at payment creation.
    # 0 when no credit was consumed; restored to the application balance
    # when the payment expires or is cancelled (PENDING-only path).
    credit_applied: Decimal = Field(
        default=Decimal("0"),
        sa_column=Column(Numeric(10, 2), nullable=False, server_default="0"),
    )


class PaymentProductRequest(BaseModel):
    """Product selection for payment."""

    product_id: uuid.UUID
    attendee_id: uuid.UUID
    quantity: int = 1
    unit_price_override: Decimal | None = None
    # Per-purchase metadata blob. Currently populated by the meal_plan_select
    # step with {daily_choices, dietary_restriction, special_request}. When set,
    # the resulting AttendeeProducts row(s) carry this blob in
    # attendee_products.purchase_metadata. NULL for products that don't collect
    # metadata.
    purchase_metadata: dict | None = None

    @model_validator(mode="after")
    def validate_unit_price_override(self) -> "PaymentProductRequest":
        """Structural validation: unit_price_override must be non-negative if provided."""
        if self.unit_price_override is not None and self.unit_price_override < 0:
            raise ValueError("unit_price_override must be non-negative")
        return self


class PaymentProductResponse(BaseModel):
    """Payment product snapshot in response."""

    product_id: uuid.UUID
    attendee_id: uuid.UUID
    quantity: int
    product_name: str
    product_description: str | None = None
    product_price: Decimal
    effective_unit_price: Decimal | None = None
    product_category: str
    product_currency: str
    attendee_name: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PaymentCreate(BaseModel):
    """Schema for creating a payment.

    Either application_id (application-based flow) or popup_id must be
    provided — at least one source is required.
    """

    application_id: uuid.UUID | None = None
    popup_id: uuid.UUID | None = None
    products: list[PaymentProductRequest]
    coupon_code: str | None = None
    edit_passes: bool = False
    insurance: bool = False

    @field_validator("products", mode="before")
    @classmethod
    def validate_products(
        cls,
        v: list[PaymentProductRequest],
    ) -> list[PaymentProductRequest]:
        if not v:
            raise ValueError("At least one product must be selected")
        return v

    @model_validator(mode="after")
    def validate_source(self) -> "PaymentCreate":
        if self.application_id is None and self.popup_id is None:
            raise ValueError("Either application_id or popup_id is required")
        return self


class PaymentPreview(BaseModel):
    """Schema for payment preview (before creating)."""

    application_id: uuid.UUID
    products: list[PaymentProductRequest]
    original_amount: Decimal
    amount: Decimal
    insurance_amount: Decimal = Decimal("0")
    contribution_amount: Decimal = Decimal("0")
    currency: str = "USD"
    edit_passes: bool = False

    # Discount info
    coupon_id: uuid.UUID | None = None
    coupon_code: str | None = None
    discount_value: Decimal | None = None
    group_id: uuid.UUID | None = None
    scholarship_discount: bool = False

    # Credit consumed from the application balance for this payment.
    credit_applied: Decimal = Decimal("0")

    # Payment provider response (populated on creation)
    status: str | None = None
    external_id: str | None = None
    checkout_url: str | None = None


class PaymentPublic(PaymentBase):
    """Payment schema for API responses."""

    id: uuid.UUID
    products_snapshot: list[PaymentProductResponse] = []
    buyer_email: str | None = None
    buyer_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class PaymentUpdate(BaseModel):
    """Schema for updating a payment (mainly status updates)."""

    status: PaymentStatus | None = None
    external_id: str | None = None
    source: PaymentSource | None = None
    rate: Decimal | None = None
    currency: str | None = None
    settlement_currency: str | None = None


class PaymentFilter(BaseModel):
    """Filters for payment queries."""

    application_id: uuid.UUID | None = None
    external_id: str | None = None
    status: PaymentStatus | None = None


class PaymentStatusCheck(BaseModel):
    """Minimal response for checking a payment's current status."""

    id: uuid.UUID
    status: PaymentStatus

    model_config = ConfigDict(from_attributes=True)


class ApplicationFeeCreate(BaseModel):
    """Schema for creating an application fee payment."""

    application_id: uuid.UUID


class SimpleFIPriceDetails(BaseModel):
    """Price details for a SimpleFI transaction."""

    currency: str
    final_amount: float
    rate: float


class SimpleFICardPayment(BaseModel):
    """Card payment info from SimpleFI."""

    provider: str
    status: str
    coin: str = "USD"
    # final_amount here is the card-rail adjusted fiat total — the amount the
    # buyer is actually charged when the merchant has card pricing configured.
    price_details: SimpleFIPriceDetails | None = None


class SimpleFITransaction(BaseModel):
    """Transaction details from SimpleFI."""

    id: str
    coin: str
    chain_id: int
    status: str
    price_details: SimpleFIPriceDetails


class SimpleFIPaymentInfo(BaseModel):
    """Payment info from SimpleFI."""

    coin: str
    hash: str
    amount: float
    paid_at: datetime


class SimpleFIPaymentRequest(BaseModel):
    """Payment request details from SimpleFI."""

    id: str
    order_id: int
    amount: float
    amount_paid: float
    currency: str
    reference: dict
    status: str
    status_detail: str
    transactions: list[SimpleFITransaction]
    card_payment: SimpleFICardPayment | None = None
    payments: list[SimpleFIPaymentInfo]
    installment_plan_id: str | None = None


class SimpleFIData(BaseModel):
    """Data payload from SimpleFI webhook."""

    payment_request: SimpleFIPaymentRequest
    new_payment: SimpleFIPaymentInfo | SimpleFICardPayment | None = None


class SimpleFIWebhookPayload(BaseModel):
    """SimpleFI webhook payload schema."""

    id: str
    event_type: str
    entity_type: str
    entity_id: str
    data: SimpleFIData


# Installment Plan Webhook Schemas


class SimpleFIInstallmentPlan(BaseModel):
    """Installment plan details from SimpleFI."""

    id: str | None = None
    status: str
    paid_installments_count: int
    number_of_installments: int
    user_email: str
    # CARD | CRYPTO. Locked once the first payment is made — SimpleFi does
    # not allow switching afterwards, so the value seen at activation holds
    # for the plan's lifetime.
    payment_method: str | None = None
    # Exactly one is set for CARD plans; identifies the charging provider.
    stripe_subscription_id: str | None = None
    mercadopago_preapproval_id: str | None = None
    reference: dict | None = None

    model_config = ConfigDict(extra="allow")


class SimpleFIInstallmentPlanData(BaseModel):
    """Data payload for installment plan webhooks."""

    installment_plan: SimpleFIInstallmentPlan


class SimpleFIInstallmentPlanPayload(BaseModel):
    """Webhook payload for installment plan events (activated/completed/cancelled)."""

    id: str | None = None
    event_type: str
    entity_type: str
    entity_id: str
    merchant_id: str | None = None
    data: SimpleFIInstallmentPlanData


# ---------------------------------------------------------------------------
# Release-on-return schemas (POST /payments/my/pending/release)
# ---------------------------------------------------------------------------


class PendingReleaseAuthRequest(BaseModel):
    """Request body for POST /payments/my/pending/release (authenticated surface).

    application_id identifies which PENDING payment to release.
    Ownership is verified server-side against current_human.id.
    """

    application_id: uuid.UUID


class PendingReleaseResponse(BaseModel):
    """Response body for both release-on-return endpoints.

    released=True only when a cancel+hold-release actually committed.
    released=False covers: invalid proof, no PENDING exists, flag disabled.
    Enumeration-safe: the body shape is identical across all False outcomes.
    """

    released: bool
