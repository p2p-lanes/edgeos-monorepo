import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator
from sqlmodel import DateTime, Field, SQLModel


class CouponBase(SQLModel):
    """Base coupon schema."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    code: str = Field(index=True)
    discount_value: int = Field(default=0)  # Percentage: 0–100
    max_uses: int | None = Field(default=None, nullable=True)
    current_uses: int = Field(default=0)
    start_date: datetime | None = Field(
        default=None, nullable=True, sa_type=DateTime(timezone=True)
    )
    end_date: datetime | None = Field(
        default=None, nullable=True, sa_type=DateTime(timezone=True)
    )
    is_active: bool = Field(default=True)


class CouponPublic(CouponBase):
    """Coupon schema for API responses."""

    id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


class CouponCreate(BaseModel):
    """Coupon schema for creation."""

    popup_id: uuid.UUID
    code: str
    discount_value: int
    max_uses: int | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    is_active: bool = True

    @field_validator("discount_value")
    @classmethod
    def validate_discount_value(cls, v: int) -> int:
        """Discount must be an integer between 0 and 100."""
        if v < 0 or v > 100:
            raise ValueError("discount_value must be between 0 and 100")
        return v

    @field_validator("code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        """Code should be uppercase and stripped."""
        return v.strip().upper()

    model_config = ConfigDict(str_strip_whitespace=True)


class CouponUpdate(BaseModel):
    """Coupon schema for updates."""

    code: str | None = None
    discount_value: int | None = None
    max_uses: int | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    is_active: bool | None = None

    @field_validator("discount_value")
    @classmethod
    def validate_discount_value(cls, v: int | None) -> int | None:
        """Discount must be an integer between 0 and 100."""
        if v is not None and (v < 0 or v > 100):
            raise ValueError("discount_value must be between 0 and 100")
        return v


class CouponValidate(BaseModel):
    """Schema for validating a coupon code."""

    popup_id: uuid.UUID
    code: str

    @field_validator("code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        """Code should be uppercase and stripped."""
        return v.strip().upper()


class CouponValidatePublicRequest(BaseModel):
    """Request schema for public coupon validation (anonymous, no JWT)."""

    popup_slug: str
    code: str

    @field_validator("code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        return v.strip().upper()


class CouponValidatePublicResponse(BaseModel):
    """Response schema for public coupon validation."""

    code: str
    discount_type: str  # always "percent" in v1
    discount_value: str  # string representation of the discount percentage
    valid: bool
