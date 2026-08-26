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
    # Which flow the recipient lands in. Omitted means the popup's default
    # flow, which is what every invite did implicitly before it could say.
    sales_flow_id: uuid.UUID | None = None
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
    is_disabled: bool | None = None

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


class InvitePortalCreate(BaseModel):
    """Attendee request body for POST /portal/invites.

    An attendee sets far less than an admin: the policy fields (discount,
    auto_approve) stay admin-only, and max_uses is dictated by the popup's
    max_referrals_per_attendee quota.
    """

    popup_id: uuid.UUID
    token: str | None = None
    max_uses: int | None = None
    expires_at: datetime | None = None

    @field_validator("max_uses")
    @classmethod
    def validate_max_uses(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("max_uses must be a positive integer or null (unlimited)")
        return v

    model_config = ConfigDict(str_strip_whitespace=True)


class InvitePortalUpdate(BaseModel):
    """Attendee request body for PATCH /portal/invites/{id} — owner-mutable only."""

    expires_at: datetime | None = None
    max_uses: int | None = None

    @field_validator("max_uses")
    @classmethod
    def validate_max_uses(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("max_uses must be a positive integer or null")
        return v


class InvitePublic(BaseModel):
    """Full link detail — admin, or the owning attendee for their own link.

    Exposes all fields including token and recipient_email.
    Never sent to unauthenticated callers.

    Exactly one issuer is set: ``created_by`` for a backoffice link,
    ``referrer_human_id`` for one an attendee created from the portal.
    """

    id: uuid.UUID
    popup_id: uuid.UUID
    sales_flow_id: uuid.UUID
    token: str
    recipient_email: str | None = None
    discount_percentage: Decimal
    auto_approve: bool
    express_checkout: bool
    is_disabled: bool = False
    max_uses: int | None = None
    current_uses: int
    used_at: datetime | None = None
    redeemed_by_human_id: uuid.UUID | None = None
    expires_at: datetime | None = None
    created_by: uuid.UUID | None = None
    referrer_human_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InvitePublicPreview(BaseModel):
    """Unauthenticated preview — GET /invites/redeem/{token}.

    Spec: REQ-GR-005 — exposes inviter_name and is_email_restricted.
    recipient_email is intentionally ABSENT to prevent harvesting.
    id is included so the portal can pass invite_id on application create
    (the checkout flow needs the UUID, not the token string).
    """

    id: uuid.UUID
    popup_id: uuid.UUID
    token: str
    inviter_name: str | None = None
    is_email_restricted: bool
    discount_percentage: Decimal
    auto_approve: bool
    max_uses: int | None = None
    current_uses: int
    expires_at: datetime | None = None
    # True when the requesting human already has an application for this popup:
    # the portal redirects them to their checkout instead of re-redeeming.
    already_redeemed: bool = False

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
