"""Referral router — portal (human) CRUD + public lookup + admin moderation.

Mounts at:
  /portal/referrals            — human: list/create mine
  /portal/referrals/{id}       — human: owner update/delete
  /referrals/r/{code}          — public: lookup preview (no auth)
  /admin/referrals             — admin: moderation list
  /admin/referrals/{id}        — admin: moderation update

Design: Decision 1c (module layout), API surface table for referrals.
Spec: REQ-GR-008..011 (referrals), REQ-GR-026 (popup.referrals_enabled gate).
"""

import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.referral.crud import referrals_crud
from app.api.referral.schemas import (
    ReferralAdminUpdate,
    ReferralCreate,
    ReferralPublic,
    ReferralPublicPreview,
    ReferralUpdate,
)
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentAdmin,
    CurrentHuman,
    SessionDep,
)

# Three separate routers with different prefixes
portal_router = APIRouter(prefix="/portal/referrals", tags=["referrals"])
public_router = APIRouter(prefix="/referrals", tags=["referrals"])
admin_router = APIRouter(prefix="/admin/referrals", tags=["referrals"])


# ---------------------------------------------------------------------------
# Portal — human: list and create my referrals
# ---------------------------------------------------------------------------


@portal_router.get("", response_model=ListModel[ReferralPublic])
async def list_my_referrals(
    db: SessionDep,
    current_human: CurrentHuman,
    popup_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[ReferralPublic]:
    """Portal: list referrals owned by the authenticated human.

    Spec: REQ-GR-008 — human-driven ambassador codes.
    Filtered by popup_id when provided.
    """
    if popup_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="popup_id is required",
        )

    results, total = referrals_crud.find_by_human(
        db, current_human.id, popup_id, skip=skip, limit=limit
    )
    return ListModel[ReferralPublic](
        results=[ReferralPublic.model_validate(r) for r in results],
        paging=Paging(limit=limit, offset=skip, total=total),
    )


@portal_router.post(
    "", response_model=ReferralPublic, status_code=status.HTTP_201_CREATED
)
async def create_referral(
    db: SessionDep,
    current_human: CurrentHuman,
    body: ReferralCreate,
) -> ReferralPublic:
    """Portal: create a referral code for the authenticated human.

    Spec: REQ-GR-008 (entity), REQ-GR-026 (popup.referrals_enabled gate).
    Code auto-generated if not provided. 409 if (popup_id, code) collides.
    """
    from app.api.popup.crud import popups_crud

    popup = popups_crud.get(db, body.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )

    # popup.referrals_enabled gate (REQ-GR-026)
    if not popup.referrals_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Referral-based applications are not enabled for this popup",
        )

    referral = referrals_crud.create_referral(
        db,
        body,
        tenant_id=popup.tenant_id,
        referrer_human_id=current_human.id,
    )
    return ReferralPublic.model_validate(referral)


@portal_router.patch("/{referral_id}", response_model=ReferralPublic)
async def update_my_referral(
    referral_id: uuid.UUID,
    db: SessionDep,
    current_human: CurrentHuman,
    body: ReferralUpdate,
) -> ReferralPublic:
    """Portal: update own referral — only expires_at and max_uses mutable.

    Spec: API surface PATCH (owner): only expires_at, max_uses mutable by owner.
    """
    referral = referrals_crud.get(db, referral_id)
    if not referral:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Referral not found"
        )

    # Owner check
    if referral.referrer_human_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this referral",
        )

    updated = referrals_crud.update_referral(db, referral, body)
    return ReferralPublic.model_validate(updated)


@portal_router.delete("/{referral_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_referral(
    referral_id: uuid.UUID,
    db: SessionDep,
    current_human: CurrentHuman,
) -> None:
    """Portal: delete own referral. 409 if current_uses > 0."""
    referral = referrals_crud.get(db, referral_id)
    if not referral:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Referral not found"
        )

    # Owner check
    if referral.referrer_human_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this referral",
        )

    referrals_crud.delete_referral(db, referral)


# ---------------------------------------------------------------------------
# Public — /referrals/r/{code}: no auth required
# ---------------------------------------------------------------------------


@public_router.get(
    "/r/{code}",
    response_model=ReferralPublicPreview,
    summary="Public referral lookup (no auth)",
)
async def get_referral_preview(code: str, db: SessionDep) -> ReferralPublicPreview:
    """Public lookup — returns ReferralPublicPreview with no PII of the referrer.

    Spec: Design API surface (public GET /referrals/r/{code}).
    Validates expiry and use limits so the portal can show an appropriate error.
    """
    referral = referrals_crud.get_by_code_any_popup(db, code)
    if not referral:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Referral not found"
        )

    # Surface guard state but do NOT raise — let the portal decide how to present
    # (the apply endpoint enforces hard errors; preview is informational only)
    return ReferralPublicPreview(
        popup_id=referral.popup_id,
        code=referral.code,
        discount_percentage=referral.discount_percentage,
        max_uses=referral.max_uses,
        current_uses=referral.current_uses,
        expires_at=referral.expires_at,
    )


# ---------------------------------------------------------------------------
# Admin — /admin/referrals: moderation list + admin field updates
# ---------------------------------------------------------------------------


@admin_router.get("", response_model=ListModel[ReferralPublic])
async def list_referrals_admin(
    db: SessionDep,
    _: CurrentAdmin,
    popup_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[ReferralPublic]:
    """Admin: moderation list — all referrals for a popup.

    Spec: API surface table — GET /admin/referrals, popup-scoped.
    """
    if popup_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="popup_id is required",
        )

    results, total = referrals_crud.find_by_popup(db, popup_id, skip=skip, limit=limit)
    return ListModel[ReferralPublic](
        results=[ReferralPublic.model_validate(r) for r in results],
        paging=Paging(limit=limit, offset=skip, total=total),
    )


@admin_router.patch("/{referral_id}", response_model=ReferralPublic)
async def update_referral_admin(
    referral_id: uuid.UUID,
    db: SessionDep,
    _: CurrentAdmin,
    body: ReferralAdminUpdate,
) -> ReferralPublic:
    """Admin: update admin-only fields (discount_percentage, auto_approve, is_disabled).

    Spec: API surface PATCH /admin/referrals/{id}.
    Admin-only fields: discount_percentage, auto_approve.
    """
    referral = referrals_crud.get(db, referral_id)
    if not referral:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Referral not found"
        )

    updated = referrals_crud.update_referral(db, referral, body)
    return ReferralPublic.model_validate(updated)
