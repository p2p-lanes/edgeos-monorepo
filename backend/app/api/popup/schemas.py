import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Self

from pydantic import ConfigDict, field_validator, model_validator
from sqlalchemy import Boolean, Column, Numeric, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlmodel import Field, SQLModel, String

from app.api.shared.enums import (
    ApplicationLayout,
    CheckoutMode,
    SaleType,
    derive_checkout_mode,
)
from app.utils.utils import slugify


def validate_popup_insurance_config(enabled: bool, pct: "Decimal | None") -> None:
    """Validate insurance_percentage bounds when insurance is enabled.

    Raises ValueError if enabled=True and pct is None, <= 0, or > 100.
    """
    if not enabled:
        return
    if pct is None or pct <= 0:
        raise ValueError(
            "insurance_percentage must be > 0 when insurance_enabled is True"
        )
    if pct > 100:
        raise ValueError(
            "insurance_percentage must be <= 100 (it represents a percentage)"
        )


def validate_popup_contribution_config(enabled: bool, pct: "Decimal | None") -> None:
    """Validate contribution_percentage bounds when contribution is enabled.

    Raises ValueError if enabled=True and pct is None, <= 0, or > 100.
    """
    if not enabled:
        return
    if pct is None or pct <= 0:
        raise ValueError(
            "contribution_percentage must be > 0 when contribution_enabled is True"
        )
    if pct > 100:
        raise ValueError(
            "contribution_percentage must be <= 100 (it represents a percentage)"
        )


ALLOWED_CURRENCIES = ("USD", "ARS", "EUR")


def validate_currency_value(value: str | None) -> str | None:
    if value is None:
        return value
    normalized = value.upper()
    if normalized not in ALLOWED_CURRENCIES:
        raise ValueError(f"currency must be one of {ALLOWED_CURRENCIES}")
    return normalized


def resolve_checkout_mode(
    sale_type: SaleType, checkout_mode: CheckoutMode | None
) -> CheckoutMode:
    derived_checkout_mode = derive_checkout_mode(sale_type)
    if checkout_mode is not None and checkout_mode != derived_checkout_mode:
        raise ValueError("checkout_mode is derived from sale_type and cannot conflict")
    return derived_checkout_mode


class PopupStatus(StrEnum):
    draft = "draft"
    active = "active"
    archived = "archived"
    ended = "ended"


class PopupBase(SQLModel):
    name: str = Field(index=True)
    tagline: str | None = None
    location: str | None = None
    slug: str = Field(index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    start_date: datetime | None = None
    end_date: datetime | None = None
    status: PopupStatus = PopupStatus.draft
    sale_type: SaleType = Field(
        default=SaleType.application,
        sa_column=Column(String, nullable=False, server_default="application"),
    )
    checkout_mode: CheckoutMode = Field(
        default=CheckoutMode.pass_system,
        sa_column=Column(String, nullable=False, server_default="pass_system"),
    )
    allows_coupons: bool | None = False
    allows_scholarship: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    allows_incentive: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    image_url: str | None = None
    icon_url: str | None = None
    express_checkout_background: str | None = None
    web_url: str | None = None
    blog_url: str | None = None
    twitter_url: str | None = None
    simplefi_api_key: str | None = None
    terms_and_conditions_url: str | None = None
    invoice_company_name: str | None = None
    invoice_company_address: str | None = None
    invoice_company_email: str | None = None
    currency: str = Field(default="USD", max_length=3)
    requires_application_fee: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    application_fee_amount: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(10, 2), nullable=True),
    )
    theme_config: dict | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    favicon_url: str | None = None
    default_language: str = Field(default="en")
    supported_languages: list[str] = Field(
        default=["en"],
        sa_column=Column(ARRAY(String), nullable=False, server_default="{en}"),
    )
    insurance_enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    insurance_percentage: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(5, 2), nullable=True),
    )
    contribution_enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    contribution_percentage: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(5, 2), nullable=True),
    )
    contribution_label: str | None = Field(default=None, max_length=255)
    contribution_description: str | None = Field(
        default=None,
        sa_column=Column(Text(), nullable=True),
    )
    application_layout: ApplicationLayout = Field(
        default=ApplicationLayout.single_page,
        sa_column=Column(String, nullable=False, server_default="single_page"),
    )
    events_enabled: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, server_default="true"),
    )
    self_check_in_enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    # Days before start_date to send the scheduled check-in pass email.
    # Null disables the check-in pass for this popup; a positive value enables
    # it and sets the lead time. Read by the check-in pass cron dispatcher.
    checkin_pass_lead_days: int | None = Field(default=None, nullable=True)
    show_attendee_directory: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    credits_enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    # Groups-rework: per-popup feature flags for invite/referral/group-private-events
    invites_enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    referrals_enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    group_private_events_enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str) -> str:
        return validate_currency_value(value) or "USD"


class PopupCreate(SQLModel):
    tenant_id: uuid.UUID | None = None
    name: str = Field(max_length=255)
    tagline: str | None = None
    location: str | None = None
    slug: str = ""
    start_date: datetime | None = None
    end_date: datetime | None = None
    status: PopupStatus = PopupStatus.draft
    sale_type: SaleType = SaleType.application
    checkout_mode: CheckoutMode | None = None
    allows_coupons: bool | None = False
    allows_scholarship: bool | None = False
    allows_incentive: bool | None = False
    image_url: str | None = None
    icon_url: str | None = None
    express_checkout_background: str | None = None
    web_url: str | None = None
    blog_url: str | None = None
    twitter_url: str | None = None
    simplefi_api_key: str | None = None
    terms_and_conditions_url: str | None = None
    invoice_company_name: str | None = None
    invoice_company_address: str | None = None
    invoice_company_email: str | None = None
    currency: str = Field(default="USD", max_length=3)
    requires_application_fee: bool = False
    application_fee_amount: Decimal | None = None
    theme_config: dict | None = None
    favicon_url: str | None = None
    default_language: str = "en"
    supported_languages: list[str] = ["en"]
    insurance_enabled: bool = False
    insurance_percentage: Decimal | None = None
    contribution_enabled: bool = False
    contribution_percentage: Decimal | None = None
    contribution_label: str | None = None
    contribution_description: str | None = None
    application_layout: ApplicationLayout = ApplicationLayout.single_page
    events_enabled: bool = True
    self_check_in_enabled: bool = False
    show_attendee_directory: bool = False
    credits_enabled: bool = False
    checkin_pass_lead_days: int | None = None

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str) -> str:
        return validate_currency_value(value) or "USD"

    @field_validator("checkin_pass_lead_days")
    @classmethod
    def validate_checkin_pass_lead_days(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("checkin_pass_lead_days must be a positive number of days")
        return value

    @model_validator(mode="after")
    def generate_slug(self) -> Self:
        self.slug = slugify(self.name)
        self.checkout_mode = resolve_checkout_mode(self.sale_type, self.checkout_mode)
        if self.requires_application_fee and (
            not self.application_fee_amount or self.application_fee_amount <= 0
        ):
            raise ValueError(
                "application_fee_amount must be greater than 0 when requires_application_fee is True"
            )
        validate_popup_insurance_config(
            self.insurance_enabled, self.insurance_percentage
        )
        validate_popup_contribution_config(
            self.contribution_enabled, self.contribution_percentage
        )
        return self


class PopupUpdate(SQLModel):
    # Reject unknown fields so deprecated ones (e.g., the removed
    # tier_progression_enabled) are surfaced as 422 instead of silently ignored.
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    tagline: str | None = None
    location: str | None = None
    slug: str | None = None
    status: PopupStatus | None = None
    sale_type: SaleType | None = None
    checkout_mode: CheckoutMode | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    allows_coupons: bool | None = None
    allows_scholarship: bool | None = None
    allows_incentive: bool | None = None
    image_url: str | None = None
    icon_url: str | None = None
    express_checkout_background: str | None = None
    web_url: str | None = None
    blog_url: str | None = None
    twitter_url: str | None = None
    simplefi_api_key: str | None = None
    terms_and_conditions_url: str | None = None
    invoice_company_name: str | None = None
    invoice_company_address: str | None = None
    invoice_company_email: str | None = None
    currency: str | None = Field(default=None, max_length=3)
    requires_application_fee: bool | None = None
    application_fee_amount: Decimal | None = None
    theme_config: dict | None = None
    favicon_url: str | None = None
    default_language: str | None = None
    supported_languages: list[str] | None = None
    insurance_enabled: bool | None = None
    insurance_percentage: Decimal | None = None
    contribution_enabled: bool | None = None
    contribution_percentage: Decimal | None = None
    contribution_label: str | None = None
    contribution_description: str | None = None
    application_layout: ApplicationLayout | None = None
    events_enabled: bool | None = None
    self_check_in_enabled: bool | None = None
    show_attendee_directory: bool | None = None
    credits_enabled: bool | None = None
    checkin_pass_lead_days: int | None = None

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str | None) -> str | None:
        return validate_currency_value(value)

    @field_validator("checkin_pass_lead_days")
    @classmethod
    def validate_checkin_pass_lead_days(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("checkin_pass_lead_days must be a positive number of days")
        return value

    @model_validator(mode="after")
    def validate_fee_config(self) -> Self:
        if self.sale_type is None:
            if self.checkout_mode is not None:
                raise ValueError(
                    "checkout_mode is derived from sale_type and cannot be updated directly"
                )
        else:
            self.checkout_mode = resolve_checkout_mode(
                self.sale_type, self.checkout_mode
            )
        if self.requires_application_fee is True and (
            not self.application_fee_amount or self.application_fee_amount <= 0
        ):
            raise ValueError(
                "application_fee_amount must be greater than 0 when requires_application_fee is True"
            )
        # Validate insurance only when insurance_enabled is explicitly set to True
        if self.insurance_enabled is True:
            validate_popup_insurance_config(True, self.insurance_percentage)
        # Validate contribution only when contribution_enabled is explicitly set to True
        if self.contribution_enabled is True:
            validate_popup_contribution_config(True, self.contribution_percentage)
        return self


class PopupPublic(SQLModel):
    """Public popup schema — excludes sensitive/internal fields."""

    id: uuid.UUID
    name: str
    tagline: str | None = None
    location: str | None = None
    slug: str
    status: PopupStatus = PopupStatus.draft
    sale_type: SaleType = SaleType.application
    checkout_mode: CheckoutMode = CheckoutMode.pass_system
    start_date: datetime | None = None
    end_date: datetime | None = None
    image_url: str | None = None
    icon_url: str | None = None
    express_checkout_background: str | None = None
    web_url: str | None = None
    blog_url: str | None = None
    twitter_url: str | None = None
    allows_coupons: bool | None = False
    allows_scholarship: bool = False
    currency: str = "USD"
    terms_and_conditions_url: str | None = None
    invoice_company_name: str | None = None
    requires_application_fee: bool = False
    application_fee_amount: Decimal | None = None
    theme_config: dict | None = None
    favicon_url: str | None = None
    default_language: str = "en"
    supported_languages: list[str] = ["en"]
    insurance_enabled: bool = False
    insurance_percentage: Decimal | None = None
    contribution_enabled: bool = False
    contribution_percentage: Decimal | None = None
    contribution_label: str | None = None
    contribution_description: str | None = None
    application_layout: ApplicationLayout = ApplicationLayout.single_page
    events_enabled: bool = True
    show_attendee_directory: bool = False
    credits_enabled: bool = False


class PopupAdmin(PopupBase):
    """Admin popup schema — all fields including sensitive ones."""

    id: uuid.UUID
