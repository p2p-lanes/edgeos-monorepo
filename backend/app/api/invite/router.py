"""Invite router — admin CRUD + portal redemption.

Mounts at:
  /invites          — admin CRUD (get_admin guard + X-Tenant-Id header)
  /invites/redeem/{token} — portal (GET: unauthenticated preview; POST: CurrentHuman)

Design: Decision 1c (module layout), API surface table for invites.
Spec: REQ-GR-001..007 (invites), REQ-GR-026 (the invites gate, which
belongs to the sales flow an invite lands its recipient in).
"""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.invite.crud import invites_crud
from app.api.invite.schemas import (
    InviteCreate,
    InvitePortalCreate,
    InvitePortalUpdate,
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
    OptionalHuman,
    SessionDep,
)

IssuerFilter = Annotated[
    Literal["all", "admin", "portal"],
    Query(description="Which links to return: both kinds, backoffice, or attendee."),
]

router = APIRouter(prefix="/invites", tags=["invites"])
portal_router = APIRouter(prefix="/portal/invites", tags=["invites"])


# ---------------------------------------------------------------------------
# Static paths BEFORE /{id} catch-all
# ---------------------------------------------------------------------------


@router.get(
    "/redeem/{token}",
    response_model=InvitePublicPreview,
    summary="Preview invite (unauthenticated)",
)
async def preview_invite(
    token: str,
    db: SessionDep,
    response: Response,
    current_human: OptionalHuman,
) -> InvitePublicPreview:
    """Preview an invite. Open to anonymous callers, but auth-aware.

    Spec: REQ-GR-005.
    Guard order for a fresh caller: ended popup → 410, expired → 410,
    exhausted → 410. A caller who already has an application for this popup
    skips those guards and gets ``already_redeemed=True`` so the portal
    redirects them to their checkout instead of re-redeeming the link.
    recipient_email is NEVER returned.
    """
    from app.api.sales_flow.resolver import config_for  # noqa: PLC0415

    # Never cache the preview — it reflects mutable invite state (max_uses,
    # current_uses, expiry) that an admin can change at any time.
    response.headers["Cache-Control"] = "no-store"

    invite = invites_crud.get_by_token_any_popup(db, token)
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found",
            headers={"Cache-Control": "no-store"},
        )

    # A caller who already has an application for this popup has already entered
    # (uq_application_human_popup makes it one per popup): redirect them to the
    # portal instead of failing the link guards below.
    already_redeemed = False
    if current_human is not None:
        from app.api.application.crud import applications_crud

        # Scoped to the invite's own flow. Popup-wide, an invite into
        # Volunteers would read as already redeemed for anyone who had
        # applied to the default flow — a different flow, a different
        # application.
        already_redeemed = (
            applications_crud.get_by_human_flow(
                db,
                human_id=current_human.id,
                sales_flow_id=invite.sales_flow_id,
            )
            is not None
        )

    if not already_redeemed:
        # Ended popup → link no longer valid (410), then expired/exhausted → 410
        from app.api.popup.crud import popups_crud
        from app.api.popup.guards import ensure_popup_link_active

        popup = popups_crud.get(db, invite.popup_id)
        ensure_popup_link_active(popup)
        if (
            popup is not None
            and not config_for(
                db, sales_flow_id=invite.sales_flow_id, popup_id=invite.popup_id
            ).invites_enabled
        ):
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="Invites are not enabled for this event",
                headers={"Cache-Control": "no-store"},
            )
        invites_crud.validate_for_redemption(invite)

    # Resolve inviter_name from the created_by user (explicit fetch — avoid lazy load)
    from sqlmodel import select as _select

    from app.api.user.models import Users

    inviter_name: str | None = None
    creator = db.exec(_select(Users).where(Users.id == invite.created_by)).first()
    if creator:
        inviter_name = creator.full_name or creator.email

    return InvitePublicPreview(
        id=invite.id,
        popup_id=invite.popup_id,
        token=invite.token,
        inviter_name=inviter_name,
        is_email_restricted=invite.recipient_email is not None,
        discount_percentage=invite.discount_percentage,
        auto_approve=invite.auto_approve,
        max_uses=invite.max_uses,
        current_uses=invite.current_uses,
        expires_at=invite.expires_at,
        already_redeemed=already_redeemed,
    )


@router.get(
    "/preview/{token}",
    response_model=InvitePublicPreview,
    summary="Preview any access link (unauthenticated)",
)
async def preview_link(
    token: str,
    db: SessionDep,
    response: Response,
    current_human: OptionalHuman,
) -> InvitePublicPreview:
    """Preview a link of either kind, resolved by token.

    Same guard order as the invite-only preview, but the popup feature flag
    checked depends on who issued the link: invites_enabled for a backoffice
    link, referrals_enabled for an attendee one.

    ``inviter_name`` is filled only for backoffice links. An attendee link
    never names its owner: it is a public URL and the owner is a private
    individual (spec: referral preview returns no PII of the referrer).
    """
    from app.api.sales_flow.resolver import config_for  # noqa: PLC0415

    response.headers["Cache-Control"] = "no-store"
    _no_store = {"Cache-Control": "no-store"}

    link = invites_crud.get_any_by_token(db, token)
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link not found",
            headers=_no_store,
        )

    already_redeemed = False
    if current_human is not None:
        from app.api.application.crud import applications_crud

        already_redeemed = (
            applications_crud.get_by_human_popup(db, current_human.id, link.popup_id)
            is not None
        )

    if not already_redeemed:
        from app.api.popup.crud import popups_crud
        from app.api.popup.guards import ensure_popup_link_active

        popup = popups_crud.get(db, link.popup_id)
        ensure_popup_link_active(popup)
        if popup is not None:
            # Both flags belong to the flow this link lands people in, not to
            # the event: a door can share while another does not.
            config = config_for(
                db, sales_flow_id=link.sales_flow_id, popup_id=link.popup_id
            )
            enabled = (
                config.referrals_enabled
                if link.is_portal_created
                else config.invites_enabled
            )
            if not enabled:
                raise HTTPException(
                    status_code=status.HTTP_410_GONE,
                    detail="This kind of link is not enabled for this event",
                    headers=_no_store,
                )
        invites_crud.validate_for_redemption(link)

    inviter_name: str | None = None
    if not link.is_portal_created:
        from sqlmodel import select as _select

        from app.api.user.models import Users

        creator = db.exec(_select(Users).where(Users.id == link.created_by)).first()
        if creator:
            inviter_name = creator.full_name or creator.email

    return InvitePublicPreview(
        id=link.id,
        popup_id=link.popup_id,
        token=link.token,
        inviter_name=inviter_name,
        is_email_restricted=link.recipient_email is not None,
        discount_percentage=link.discount_percentage,
        auto_approve=link.auto_approve,
        max_uses=link.max_uses,
        current_uses=link.current_uses,
        expires_at=link.expires_at,
        already_redeemed=already_redeemed,
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
    from app.api.sales_flow.resolver import config_for  # noqa: PLC0415

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

    popup = popups_crud.get(db, invite.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )

    # Guard chain step 0: ended popup → link no longer valid
    from app.api.popup.guards import ensure_popup_link_active

    ensure_popup_link_active(popup)

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

    # The flow this invite lands its recipient in decides whether it may
    # (REQ-GR-026, now per flow).
    if not config_for(
        db, sales_flow_id=invite.sales_flow_id, popup_id=invite.popup_id
    ).invites_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invite-based applications are not enabled for this popup",
        )

    # Increment uses atomically
    invites_crud.increment_uses(db, invite, redeemed_by_human_id=current_human.id)

    # Create application using invite's flags. The invite names the flow,
    # so the application lands where the invite meant rather than in
    # whichever flow the popup happens to call default.
    app_create = ApplicationCreate(
        popup_id=invite.popup_id,
        sales_flow_id=invite.sales_flow_id,
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

    # Apply invite attribution and flags directly (REQ-GR-004).
    # express_checkout: the Application model does not store this as a column;
    # express checkout is a validation-scope concept in create_internal
    # (controls which fields are required). Since create_internal is called
    # with validate_custom_fields=False for invite-redeemed applications,
    # all field requirements are already relaxed. The invite's express_checkout
    # flag is respected implicitly — the redemption path never blocks on
    # required fields regardless of the flag value.
    application.invite_id = invite.id
    if invite.auto_approve:
        if not human_row.red_flag:
            from datetime import UTC, datetime

            application.status = ApplicationStatus.ACCEPTED.value
            application.accepted_at = datetime.now(UTC)
        else:
            application.status = ApplicationStatus.REJECTED.value

    # Invite discount is NOT copied onto application.discount_percentage —
    # that column is scholarship-only. The payment path reads the invite row
    # live via application.invite_id (see payment/crud._apply_discounts).
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
    issuer: IssuerFilter = "all",
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[InvitePublic]:
    """Admin: list access links, optionally filtered by popup or recipient.

    ``issuer`` narrows to backoffice links ("admin") or attendee-created ones
    ("portal"). Both kinds are moderated from here since they were merged.

    Spec: REQ-GR-006 — admin listing scoped to current tenant via RLS.
    """
    if popup_id:
        results, total = invites_crud.find_by_popup(
            db,
            popup_id,
            recipient_email=recipient_email,
            issuer=issuer,
            skip=skip,
            limit=limit,
        )
    else:
        results, total = invites_crud.find(db, skip=skip, limit=limit)

    return ListModel[InvitePublic](
        results=[InvitePublic.model_validate(r) for r in results],
        paging=Paging(limit=limit, offset=skip, total=total),
    )


def _resolve_invite_flow_id(
    db: SessionDep,
    popup_id: uuid.UUID,
    explicit_flow_id: uuid.UUID | None,
) -> uuid.UUID:
    """The flow an invite lands its recipient in.

    Omitted means the popup's default flow, which is where every invite
    landed people before it could say otherwise
    (sdd/sales-flows-rediseno).

    Only an application flow may be named. Redeeming an invite creates an
    application, so an invite into a direct sale would redeem into nothing —
    the same rule the approval strategy enforces, and 404 before 422 so a
    flow of another popup is never described back to the caller.
    """
    from app.api.sales_flow.crud import sales_flows_crud
    from app.api.sales_flow.schemas import SalesFlowType

    if explicit_flow_id is None:
        default_flow = sales_flows_crud.get_default_flow(db, popup_id)
        if default_flow is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sales flow not found",
            )
        flow = default_flow
    else:
        flow = sales_flows_crud.get(db, explicit_flow_id)
        if flow is None or flow.popup_id != popup_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sales flow not found for this popup",
            )

    if flow.type != SalesFlowType.application:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Invites can only be sent for application flows. "
                f"This flow sells directly ({flow.type})."
            ),
        )
    return flow.id


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
    from app.api.sales_flow.resolver import config_for  # noqa: PLC0415

    # Resolve popup to get tenant_id and check feature flag
    popup = popups_crud.get(db, body.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )

    # Resolve the target flow BEFORE the gate: the flow being invited into is
    # the one that decides whether invites are allowed (REQ-GR-026, now per
    # flow), so asking before resolving would ask the wrong door.
    body.sales_flow_id = _resolve_invite_flow_id(db, popup.id, body.sales_flow_id)

    if not config_for(
        db, sales_flow_id=body.sales_flow_id, popup_id=popup.id
    ).invites_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invite-based applications are not enabled for this sales flow",
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


# ---------------------------------------------------------------------------
# Portal — an attendee's own links (what used to be /portal/referrals)
# ---------------------------------------------------------------------------


@portal_router.get("", response_model=ListModel[InvitePublic])
async def list_my_links(
    db: SessionDep,
    current_human: CurrentHuman,
    popup_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[InvitePublic]:
    """Portal: list the links this attendee created for a popup."""
    if popup_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="popup_id is required",
        )

    results, total = invites_crud.find_by_human(
        db, current_human.id, popup_id, skip=skip, limit=limit
    )
    return ListModel[InvitePublic](
        results=[InvitePublic.model_validate(r) for r in results],
        paging=Paging(limit=limit, offset=skip, total=total),
    )


@portal_router.post(
    "", response_model=InvitePublic, status_code=status.HTTP_201_CREATED
)
async def create_my_link(
    db: SessionDep,
    current_human: CurrentHuman,
    body: InvitePortalCreate,
) -> InvitePublic:
    """Portal: create this attendee's link for a popup.

    Spec: REQ-GR-008 (entity), REQ-GR-026 (the attendee-links gate,
    which belongs to the flow the sharer came through).
    Token auto-generated when omitted. 409 if (popup_id, token) collides.
    """
    from app.api.application.crud import applications_crud
    from app.api.popup.crud import popups_crud
    from app.api.sales_flow.resolver import config_for  # noqa: PLC0415

    popup = popups_crud.get(db, body.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )

    # The door this attendee came through is the one they would be sharing,
    # so it is the one that decides whether they may — and at what rate.
    link_flow_id = invites_crud._flow_for_attendee_link(
        db, body.popup_id, current_human.id
    )
    link_config = config_for(db, sales_flow_id=link_flow_id, popup_id=popup.id)
    if not link_config.referrals_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Attendee links are not enabled for this way in",
        )

    # Reuse the popup access gate so accepted applicants and self/managed access
    # holders qualify, while participant/order holdings and bare attendees do not.
    if not applications_crud.resolve_popup_access(
        db, current_human.id, body.popup_id
    ).allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You need a ticket for this popup to create a link.",
        )

    # One link per attendee per popup.
    _, existing_count = invites_crud.find_by_human(
        db, current_human.id, body.popup_id, limit=1
    )
    if existing_count >= 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have a link for this popup.",
        )

    # Popup config always dictates max_uses, even when it says unlimited.
    link = invites_crud.create_portal_link(
        db,
        body,
        tenant_id=popup.tenant_id,
        referrer_human_id=current_human.id,
        max_uses_override=link_config.max_referrals_per_attendee,
    )
    return InvitePublic.model_validate(link)


@portal_router.patch("/{link_id}", response_model=InvitePublic)
async def update_my_link(
    link_id: uuid.UUID,
    db: SessionDep,
    current_human: CurrentHuman,
    body: InvitePortalUpdate,
) -> InvitePublic:
    """Portal: update own link — only expires_at and max_uses are mutable."""
    link = invites_crud.get_portal_created(db, link_id)
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Link not found"
        )

    if link.referrer_human_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this link",
        )

    updated = invites_crud.update_invite(db, link, body)
    return InvitePublic.model_validate(updated)


@portal_router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_link(
    link_id: uuid.UUID,
    db: SessionDep,
    current_human: CurrentHuman,
) -> None:
    """Portal: delete own link. 409 if it has already been used."""
    link = invites_crud.get_portal_created(db, link_id)
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Link not found"
        )

    if link.referrer_human_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this link",
        )

    invites_crud.delete_invite(db, link)
