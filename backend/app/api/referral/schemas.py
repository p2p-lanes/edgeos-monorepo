"""Referral schemas — request/response types for the referral module.

Design: Decision 1c (standard per-API module layout).
Spec: REQ-GR-008 (entity fields), REQ-GR-009 (attribution on application),
      REQ-GR-010 (max_uses enforcement).
"""

import secrets
import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator


class ReferralCreate(BaseModel):
    """Human request body for POST /portal/referrals.

    code: auto-generated via secrets.token_urlsafe(16) when omitted.
    discount_percentage: defaults to 0. Only admin can change after creation.
    auto_approve: defaults to False. Only admin can change.
    """

    popup_id: uuid.UUID
    code: str | None = None
    max_uses: int | None = None
    expires_at: datetime | None = None

    @field_validator("max_uses")
    @classmethod
    def validate_max_uses(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("max_uses must be a positive integer or null (unlimited)")
        return v

    model_config = ConfigDict(str_strip_whitespace=True)


class ReferralUpdate(BaseModel):
    """Human request body for PATCH /portal/referrals/{id}.

    Only expires_at and max_uses are mutable by the referral owner.
    discount_percentage and auto_approve are admin-only.
    """

    expires_at: datetime | None = None
    max_uses: int | None = None

    @field_validator("max_uses")
    @classmethod
    def validate_max_uses(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("max_uses must be a positive integer or null")
        return v


class ReferralAdminUpdate(BaseModel):
    """Admin request body for PATCH /admin/referrals/{id}.

    Extends owner fields with admin-only fields (discount_percentage, auto_approve).
    """

    expires_at: datetime | None = None
    max_uses: int | None = None
    discount_percentage: Decimal | None = None
    auto_approve: bool | None = None

    @field_validator("max_uses")
    @classmethod
    def validate_max_uses(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("max_uses must be a positive integer or null")
        return v

    @field_validator("discount_percentage")
    @classmethod
    def validate_discount(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and (v < 0 or v > 100):
            raise ValueError("discount_percentage must be between 0 and 100")
        return v


class ReferralPublic(BaseModel):
    """Full referral detail — owner/admin response."""

    id: uuid.UUID
    popup_id: uuid.UUID
    referrer_human_id: uuid.UUID
    code: str
    discount_percentage: Decimal
    auto_approve: bool
    max_uses: int | None = None
    current_uses: int
    expires_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReferralPublicPreview(BaseModel):
    """Public lookup — GET /referrals/r/{code}.

    Spec: Design API surface table — returns no PII of referrer.
    """

    popup_id: uuid.UUID
    code: str
    discount_percentage: Decimal
    max_uses: int | None = None
    current_uses: int
    expires_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


def generate_referral_code() -> str:
    """Generate a URL-safe opaque referral code, ≥16 chars (spec: REQ-GR-008)."""
    return secrets.token_urlsafe(16)
