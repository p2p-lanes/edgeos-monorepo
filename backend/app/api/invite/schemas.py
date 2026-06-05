"""Invite schemas — request/response types for the invite module.

Design: Decision 1c (standard per-API module layout).
Spec: REQ-GR-001 (entity fields), REQ-GR-005 (preview: inviter_name, is_email_restricted).
"""

import secrets
import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator


class InviteCreate(BaseModel):
    """Admin request body for POST /invites.

    token: auto-generated via secrets.token_urlsafe(16) when omitted.
    recipient_email: stored lowercase; NULL means open invite.
    """

    popup_id: uuid.UUID
    token: str | None = None
    recipient_email: str | None = None
    discount_percentage: Decimal = Decimal("0")
    auto_approve: bool = True
    express_checkout: bool = True
    max_uses: int | None = 1

    @field_validator("recipient_email", mode="before")
    @classmethod
    def normalize_email(cls, v: str | None) -> str | None:
        if v is not None:
            return v.lower().strip()
        return v

    @field_validator("discount_percentage")
    @classmethod
    def validate_discount(cls, v: Decimal) -> Decimal:
        if v < 0 or v > 100:
            raise ValueError("discount_percentage must be between 0 and 100")
        return v

    @field_validator("max_uses")
    @classmethod
    def validate_max_uses(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("max_uses must be a positive integer or null (unlimited)")
        return v

    model_config = ConfigDict(str_strip_whitespace=True)


class InviteUpdate(BaseModel):
    """Admin request body for PATCH /invites/{id}.

    token and recipient_email are immutable post-create.
    """

    expires_at: datetime | None = None
    max_uses: int | None = None
    discount_percentage: Decimal | None = None
    auto_approve: bool | None = None
    express_checkout: bool | None = None

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


class InvitePublic(BaseModel):
    """Full invite detail — admin-only response.

    Exposes all fields including token and recipient_email.
    Never sent to unauthenticated callers.
    """

    id: uuid.UUID
    popup_id: uuid.UUID
    token: str
    recipient_email: str | None = None
    discount_percentage: Decimal
    auto_approve: bool
    express_checkout: bool
    max_uses: int | None = None
    current_uses: int
    used_at: datetime | None = None
    redeemed_by_human_id: uuid.UUID | None = None
    expires_at: datetime | None = None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InvitePublicPreview(BaseModel):
    """Unauthenticated preview — GET /invites/redeem/{token}.

    Spec: REQ-GR-005 — exposes inviter_name and is_email_restricted.
    recipient_email is intentionally ABSENT to prevent harvesting.
    """

    popup_id: uuid.UUID
    token: str
    inviter_name: str | None = None
    is_email_restricted: bool
    discount_percentage: Decimal
    max_uses: int | None = None
    current_uses: int
    expires_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class InviteRedeemRequest(BaseModel):
    """Portal redemption body — POST /invites/redeem/{token}."""

    popup_id: uuid.UUID


class InviteRedeemResponse(BaseModel):
    """Response after successful redemption.

    Includes the created application's public representation.
    """

    invite_id: uuid.UUID
    application_id: uuid.UUID
    application_status: str


def generate_invite_token() -> str:
    """Generate a URL-safe opaque token, ≥16 chars (spec: REQ-GR-001)."""
    return secrets.token_urlsafe(16)
