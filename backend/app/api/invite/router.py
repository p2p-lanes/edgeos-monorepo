"""Invite router — admin CRUD + portal redemption.

Mounts at:
  /invites          — admin CRUD (get_admin guard + X-Tenant-Id header)
  /invites/redeem/{token} — portal (GET: unauthenticated preview; POST: CurrentHuman)

Design: Decision 1c (module layout), API surface table for invites.
Spec: REQ-GR-001..007 (invites), REQ-GR-026 (popup.invites_enabled gate).
"""

import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.invite.crud import invites_crud
from app.api.invite.schemas import (
    InviteCreate,
    InvitePublic,
    InvitePublicPreview,
    InviteRedeemRequest,
    InviteRedeemResponse,
    InviteUpdate,
)
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentAdmin,
    CurrentHuman,
    SessionDep,
)

router = APIRouter(prefix="/invites", tags=["invites"])


# ---------------------------------------------------------------------------
# Static paths BEFORE /{id} catch-all
# ---------------------------------------------------------------------------


@router.get(
    "/redeem/{token}",
    response_model=InvitePublicPreview,
    summary="Preview invite (unauthenticated)",
)
async def preview_invite(token: str, db: SessionDep) -> InvitePublicPreview:
    """Unauthenticated preview — returns inviter_name and is_email_restricted.

    Spec: REQ-GR-005.
    Guard order checked here for preview: expired → 410, exhausted → 410.
    recipient_email is NEVER returned.
    """
    invite = invites_crud.get_by_token_any_popup(db, token)
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found"
        )

    # Apply guard chain for preview as well (expired/exhausted → 410)
    invites_crud.validate_for_redemption(invite)

    # Resolve inviter_name from the created_by user (explicit fetch — avoid lazy load)
    from sqlmodel import select as _select

    from app.api.user.models import Users

    inviter_name: str | None = None
    creator = db.exec(_select(Users).where(Users.id == invite.created_by)).first()
    if creator:
        inviter_name = creator.full_name or creator.email

    return InvitePublicPreview(
        popup_id=invite.popup_id,
        token=invite.token,
        inviter_name=inviter_name,
        is_email_restricted=invite.recipient_email is not None,
        discount_percentage=invite.discount_percentage,
        max_uses=invite.max_uses,
        current_uses=invite.current_uses,
        expires_at=invite.expires_at,
    )


@router.post(
    "/redeem/{token}",
    response_model=InviteRedeemResponse,
    summary="Redeem invite (portal human)",
)
async def redeem_invite(
    token: str,
    body: InviteRedeemRequest,
    db: SessionDep,
    current_human: CurrentHuman,
) -> InviteRedeemResponse:
    """Portal redemption endpoint — requires authenticated human.

    Guard order (REQ-GR-003):
      1. Expiration  → 410 Gone
      2. Use limit   → 410 Gone
      3. Email match → 403 Forbidden
      4. Double-redeem same human → 409 Conflict
      5. On success: increment current_uses, create application.

    REQ-GR-004: invite flags (auto_approve, express_checkout, discount_percentage)
    are applied to the created application.
    """
    from app.api.application.crud import applications_crud
    from app.api.application.schemas import ApplicationCreate, ApplicationStatus
    from app.api.popup.crud import popups_crud

    invite = invites_crud.get_by_token_any_popup(db, token)
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found"
        )

    # Validate popup_id matches what caller expects
    if invite.popup_id != body.popup_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found"
        )

    # Guard chain steps 1 and 2
    invites_crud.validate_for_redemption(invite)

    # Guard chain step 3: recipient_email match (case-insensitive)
    if invite.recipient_email is not None:
        if invite.recipient_email.lower() != current_human.email.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This invite is restricted to a different email address",
            )

    # Guard chain step 4: double-redeem by the same human
    if invites_crud.has_redeemed(db, invite.id, current_human.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already redeemed this invite",
        )

    # Check popup.invites_enabled guard (REQ-GR-026)
    popup = popups_crud.get(db, invite.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )
    if not popup.invites_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invite-based applications are not enabled for this popup",
        )

    # Increment uses atomically
    invites_crud.increment_uses(db, invite, redeemed_by_human_id=current_human.id)

    # Create application using invite's flags
    app_create = ApplicationCreate(
        popup_id=invite.popup_id,
        first_name=current_human.first_name or "",
        last_name=current_human.last_name or "",
        email=current_human.email,
    )

    # Build data dict for internal create, injecting invite-specific fields
    # We call create_internal but need to pass invite attribution.
    # Use a minimal dict and inject directly via ApplicationCreate + crud.create_internal.
    from sqlmodel import select

    from app.api.human.models import Humans

    human_row = db.exec(select(Humans).where(Humans.id == current_human.id)).first()
    if not human_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Human not found"
        )

    # Create the application via crud
    application = applications_crud.create_internal(
        db,
        app_create,
        tenant_id=invite.tenant_id,
        human_id=current_human.id,
        validate_custom_fields=False,
    )

    # Apply invite attribution and flags directly
    application.invite_id = invite.id
    if invite.auto_approve:
        if not human_row.red_flag:
            from datetime import UTC, datetime

            application.status = ApplicationStatus.ACCEPTED.value
            application.accepted_at = datetime.now(UTC)
        else:
            application.status = ApplicationStatus.REJECTED.value

    if invite.discount_percentage:
        application.discount_percentage = invite.discount_percentage

    db.add(application)
    db.commit()
    db.refresh(application)

    return InviteRedeemResponse(
        invite_id=invite.id,
        application_id=application.id,
        application_status=application.status,
    )


# ---------------------------------------------------------------------------
# Admin CRUD — /{id} catch-all patterns BELOW static paths
# ---------------------------------------------------------------------------


@router.get("", response_model=ListModel[InvitePublic])
async def list_invites(
    db: SessionDep,
    _: CurrentAdmin,
    popup_id: uuid.UUID | None = None,
    recipient_email: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[InvitePublic]:
    """Admin: list invites, optionally filtered by popup_id or recipient_email.

    Spec: REQ-GR-006 — admin listing scoped to current tenant via RLS.
    """
    if popup_id:
        results, total = invites_crud.find_by_popup(
            db, popup_id, recipient_email=recipient_email, skip=skip, limit=limit
        )
    else:
        results, total = invites_crud.find(db, skip=skip, limit=limit)

    return ListModel[InvitePublic](
        results=[InvitePublic.model_validate(r) for r in results],
        paging=Paging(limit=limit, offset=skip, total=total),
    )


@router.post("", response_model=InvitePublic, status_code=status.HTTP_201_CREATED)
async def create_invite(
    db: SessionDep,
    current_user: CurrentAdmin,
    body: InviteCreate,
) -> InvitePublic:
    """Admin: create an invite for a popup.

    Spec: REQ-GR-001 (entity), REQ-GR-002 (admin-only), REQ-GR-026 (popup flag gate).
    Token auto-generated if not provided.
    409 if (popup_id, token) collides.
    """
    from app.api.popup.crud import popups_crud

    # Resolve popup to get tenant_id and check feature flag
    popup = popups_crud.get(db, body.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )

    # popup.invites_enabled gate (REQ-GR-026)
    if not popup.invites_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invite-based applications are not enabled for this popup",
        )

    # Use admin's tenant_id if set, otherwise derive from popup (for superadmin)
    tenant_id = current_user.tenant_id or popup.tenant_id

    invite = invites_crud.create_invite(
        db,
        body,
        tenant_id=tenant_id,
        created_by=current_user.id,
    )
    return InvitePublic.model_validate(invite)


@router.get("/{invite_id}", response_model=InvitePublic)
async def get_invite(
    invite_id: uuid.UUID,
    db: SessionDep,
    _: CurrentAdmin,
) -> InvitePublic:
    """Admin: get single invite by id."""
    invite = invites_crud.get(db, invite_id)
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found"
        )
    return InvitePublic.model_validate(invite)


@router.patch("/{invite_id}", response_model=InvitePublic)
async def update_invite(
    invite_id: uuid.UUID,
    db: SessionDep,
    _: CurrentAdmin,
    body: InviteUpdate,
) -> InvitePublic:
    """Admin: update mutable fields on invite.

    token and recipient_email are immutable post-create → 400 if attempted.
    Spec: API surface PATCH allowed fields.
    """
    invite = invites_crud.get(db, invite_id)
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found"
        )

    updated = invites_crud.update_invite(db, invite, body)
    return InvitePublic.model_validate(updated)


@router.delete("/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invite(
    invite_id: uuid.UUID,
    db: SessionDep,
    _: CurrentAdmin,
) -> None:
    """Admin: delete invite. 409 if current_uses > 0."""
    invite = invites_crud.get(db, invite_id)
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found"
        )
    invites_crud.delete_invite(db, invite)
