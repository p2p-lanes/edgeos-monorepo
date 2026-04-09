import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Self

from pydantic import model_validator
from sqlalchemy import Boolean, Numeric
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, Field, SQLModel

from app.utils.utils import slugify


class PopupStatus(StrEnum):
    draft = "draft"
    active = "active"
    archived = "archived"
    ended = "ended"


class PopupBase(SQLModel):
    name: str = Field(index=True)
    tagline: str | None = None
    location: str | None = None
    slug: str = Field(unique=True, index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    start_date: datetime | None = None
    end_date: datetime | None = None
    status: PopupStatus = PopupStatus.draft
    allows_spouse: bool | None = False
    allows_children: bool | None = False
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


class PopupCreate(SQLModel):
    tenant_id: uuid.UUID | None = None
    name: str = Field(max_length=255)
    tagline: str | None = None
    location: str | None = None
    slug: str = ""
    start_date: datetime | None = None
    end_date: datetime | None = None
    status: PopupStatus = PopupStatus.draft
    allows_spouse: bool | None = False
    allows_children: bool | None = False
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
    requires_application_fee: bool = False
    application_fee_amount: Decimal | None = None
    theme_config: dict | None = None

    @model_validator(mode="after")
    def generate_slug(self) -> Self:
        self.slug = slugify(self.name)
        if self.requires_application_fee and (
            not self.application_fee_amount or self.application_fee_amount <= 0
        ):
            raise ValueError(
                "application_fee_amount must be greater than 0 when requires_application_fee is True"
            )
        return self


class PopupUpdate(SQLModel):
    name: str | None = None
    tagline: str | None = None
    location: str | None = None
    slug: str | None = None
    status: PopupStatus | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    allows_spouse: bool | None = None
    allows_children: bool | None = None
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
    requires_application_fee: bool | None = None
    application_fee_amount: Decimal | None = None
    theme_config: dict | None = None

    @model_validator(mode="after")
    def validate_fee_config(self) -> Self:
        if self.requires_application_fee is True and (
            not self.application_fee_amount or self.application_fee_amount <= 0
        ):
            raise ValueError(
                "application_fee_amount must be greater than 0 when requires_application_fee is True"
            )
        return self


class PopupPublic(SQLModel):
    """Public popup schema — excludes sensitive/internal fields."""

    id: uuid.UUID
    name: str
    tagline: str | None = None
    location: str | None = None
    slug: str
    status: PopupStatus = PopupStatus.draft
    start_date: datetime | None = None
    end_date: datetime | None = None
    image_url: str | None = None
    icon_url: str | None = None
    express_checkout_background: str | None = None
    web_url: str | None = None
    blog_url: str | None = None
    twitter_url: str | None = None
    allows_spouse: bool | None = False
    allows_children: bool | None = False
    allows_coupons: bool | None = False
    allows_scholarship: bool = False
    terms_and_conditions_url: str | None = None
    invoice_company_name: str | None = None
    requires_application_fee: bool = False
    application_fee_amount: Decimal | None = None
    theme_config: dict | None = None


class PopupAdmin(PopupBase):
    """Admin popup schema — all fields including sensitive ones."""

    id: uuid.UUID
