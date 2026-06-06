import uuid
from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException, status

if TYPE_CHECKING:
    from sqlmodel import Session

    from app.api.invite.schemas import InvitePublicPreview

from app.api.group import crud
from app.api.group.models import Groups
from app.api.group.schemas import (
    AddMemberByApplicationRequest,
    GroupAdminUpdate,
    GroupCreate,
    GroupMemberBatch,
    GroupMemberBatchResult,
    GroupMemberCreate,
    GroupMemberPublic,
    GroupMemberUpdate,
    GroupPublic,
    GroupSlugResolution,
    GroupUpdate,
    GroupWithMembers,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.translation.service import delete_translations_for_entity
from app.core.dependencies.users import (
    AdminOrApiKey_GroupsRead,
    AdminOrApiKey_GroupsWrite,
    AdminOrApiKeySession_GroupsRead,
    AdminOrApiKeySession_GroupsWrite,
    CurrentHuman,
    SessionDep,
)
from app.utils.utils import slugify

router = APIRouter(prefix="/groups", tags=["groups"])


def _check_leader_permission(group: Groups, human_id: uuid.UUID) -> None:
    """Check if human is a leader of the group."""
    if not group.is_leader(human_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a leader of this group",
        )


def _build_members(group: Groups) -> list[GroupMemberPublic]:
    """Build the vigente members list of a group.

    Source of truth is the GroupMembers junction (group.members). Products and
    profile data are hydrated from each member's application in this popup, if
    one exists (it should, given the sync in application creation).
    """
    apps_by_human = {app.human_id: app for app in group.applications}

    members: list[GroupMemberPublic] = []
    for human in group.members:
        application = apps_by_human.get(human.id)
        products = []
        if application:
            # Each AttendeeProducts row is one ticket — dedupe by product_id so
            # the member's product list shows each product once.
            seen_pids: set[uuid.UUID] = set()
            for attendee in application.attendees:
                for ap in attendee.attendee_products:
                    if ap.product_id in seen_pids:
                        continue
                    seen_pids.add(ap.product_id)
                    products.append(ap.product)

        custom = (application.custom_fields if application else None) or {}
        members.append(
            GroupMemberPublic(
                id=human.id,
                first_name=human.first_name or "",
                last_name=human.last_name or "",
                email=human.email,
                telegram=human.telegram,
                organization=custom.get("organization"),
                role=custom.get("role"),
                gender=human.gender,
                local_resident=None,
                products=products,
            )
        )
    return members


@router.get("", response_model=ListModel[GroupPublic])
async def list_groups(
    db: AdminOrApiKeySession_GroupsRead,
    _: AdminOrApiKey_GroupsRead,
    popup_id: uuid.UUID | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[GroupPublic]:
    """List all groups (BO only)."""
    if popup_id:
        groups, total = crud.groups_crud.find_by_popup(
            db, popup_id=popup_id, skip=skip, limit=limit, search=search
        )
    else:
        groups, total = crud.groups_crud.find(
            db, skip=skip, limit=limit, search=search, search_fields=["name"]
        )

    return ListModel[GroupPublic](
        results=[GroupPublic.model_validate(g) for g in groups],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{group_id}", response_model=GroupWithMembers)
async def get_group(
    group_id: uuid.UUID,
    db: AdminOrApiKeySession_GroupsRead,
    _: AdminOrApiKey_GroupsRead,
) -> GroupWithMembers:
    """Get a single group with members (BO only)."""
    group = crud.groups_crud.get_with_members(db, group_id)

    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    return GroupWithMembers(
        **GroupPublic.model_validate(group).model_dump(),
        members=_build_members(group),
    )


@router.post("", response_model=GroupPublic, status_code=status.HTTP_201_CREATED)
async def create_group(
    group_in: GroupCreate,
    db: AdminOrApiKeySession_GroupsWrite,
    current_user: AdminOrApiKey_GroupsWrite,
) -> GroupPublic:
    """Create a new group (BO only)."""

    # Generate slug if not provided
    slug = group_in.slug or slugify(group_in.name)

    # Check for existing group with same slug in popup
    existing = crud.groups_crud.get_by_slug(db, slug, group_in.popup_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A group with this slug already exists in this popup",
        )

    # Get tenant_id
    if current_user.role == UserRole.SUPERADMIN:
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, group_in.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )
        tenant_id = popup.tenant_id
    else:
        tenant_id = current_user.tenant_id

    # Set resolved slug before delegating to CRUD
    group_in.slug = slug

    group = crud.groups_crud.create(db, group_in, tenant_id=tenant_id)

    return GroupPublic.model_validate(group)


@router.patch("/{group_id}", response_model=GroupPublic)
async def update_group(
    group_id: uuid.UUID,
    group_in: GroupAdminUpdate,
    db: AdminOrApiKeySession_GroupsWrite,
    _current_user: AdminOrApiKey_GroupsWrite,
) -> GroupPublic:
    """Update a group (BO only - full admin access)."""

    group = crud.groups_crud.get(db, group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    # Check slug uniqueness if being updated
    if group_in.slug and group_in.slug != group.slug:
        existing = crud.groups_crud.get_by_slug(db, group_in.slug, group.popup_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A group with this slug already exists in this popup",
            )

    updated = crud.groups_crud.update(db, group, group_in)  # type: ignore[arg-type]
    return GroupPublic.model_validate(updated)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: uuid.UUID,
    db: AdminOrApiKeySession_GroupsWrite,
    _current_user: AdminOrApiKey_GroupsWrite,
) -> None:
    """Delete a group (BO only)."""

    group = crud.groups_crud.get(db, group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    # Check if group has applications with products
    for app in group.applications:
        for attendee in app.attendees:
            if attendee.products:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot delete group with members that have purchased products",
                )

    delete_translations_for_entity(db, "group", group.id)
    crud.groups_crud.delete(db, group)


@router.get("/my/groups", response_model=ListModel[GroupPublic])
async def list_my_groups(
    db: SessionDep,
    current_human: CurrentHuman,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[GroupPublic]:
    """List groups where current human is a leader (Portal)."""
    groups, total = crud.groups_crud.find_by_leader(
        db, human_id=current_human.id, skip=skip, limit=limit
    )

    return ListModel[GroupPublic](
        results=[GroupPublic.model_validate(g) for g in groups],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/my/{group_id}", response_model=GroupWithMembers)
async def get_my_group(
    group_id: uuid.UUID,
    db: SessionDep,
    current_human: CurrentHuman,
) -> GroupWithMembers:
    """Get a group where current human is a leader (Portal)."""
    group = crud.groups_crud.get_with_members(db, group_id)

    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    _check_leader_permission(group, current_human.id)

    return GroupWithMembers(
        **GroupPublic.model_validate(group).model_dump(),
        members=_build_members(group),
    )


@router.patch("/my/{group_id}", response_model=GroupPublic)
async def update_my_group(
    group_id: uuid.UUID,
    group_in: GroupUpdate,
    db: SessionDep,
    current_human: CurrentHuman,
) -> GroupPublic:
    """Update a group where current human is a leader (Portal - limited fields)."""
    group = crud.groups_crud.get(db, group_id)

    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    _check_leader_permission(group, current_human.id)

    updated = crud.groups_crud.update(db, group, group_in)
    return GroupPublic.model_validate(updated)


@router.post(
    "/my/{group_id}/members",
    response_model=GroupMemberPublic,
    status_code=status.HTTP_201_CREATED,
)
async def add_group_member(
    group_id: uuid.UUID,
    member_in: GroupMemberCreate,
    db: SessionDep,
    current_human: CurrentHuman,
) -> GroupMemberPublic:
    """Add a member to a group (Portal - leader only)."""
    from app.api.application.crud import applications_crud
    from app.api.application.schemas import ApplicationAdminCreate, ApplicationStatus
    from app.api.human.crud import humans_crud

    group = crud.groups_crud.get(db, group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    _check_leader_permission(group, current_human.id)

    # Get or create human (Human stores identity only, profile goes in Application)
    human = humans_crud.get_by_email(db, member_in.email, group.tenant_id)
    if not human:
        from app.api.human.models import Humans

        human = Humans(tenant_id=group.tenant_id, email=member_in.email)
        db.add(human)
        db.flush()

    # Validate member addition
    crud.groups_crud.validate_member_addition(group, human.id, update_existing=False)

    # Check if human is red-flagged - they are automatically rejected
    if human.red_flag:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add red-flagged human to group. They are automatically rejected.",
        )

    # Check for existing application
    application = applications_crud.get_by_human_popup(db, human.id, group.popup_id)

    if not application:
        # Create new application with ACCEPTED status
        # Note: local_resident and created_by_leader are not on ApplicationAdminCreate
        # These would need schema changes to support
        app_data = ApplicationAdminCreate(
            popup_id=group.popup_id,
            group_id=group.id,
            first_name=member_in.first_name,
            last_name=member_in.last_name,
            email=member_in.email,
            telegram=member_in.telegram,
            gender=member_in.gender,
            status=ApplicationStatus.ACCEPTED,
        )
        application = applications_crud.create_internal(
            db,
            app_data,
            group.tenant_id,
            human.id,
        )
    else:
        # Update existing application and human profile
        application.group_id = group.id
        try:
            applications_crud.accept(db, application)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Cannot accept application from a red-flagged human.",
            )
        # Update human profile
        human.first_name = member_in.first_name
        human.last_name = member_in.last_name
        human.telegram = member_in.telegram
        human.gender = member_in.gender
        db.add(human)

    # Add to group members
    if not crud.groups_crud.is_member(db, group.id, human.id):
        crud.groups_crud.add_member(db, group.id, human.id, tenant_id=group.tenant_id)

    db.commit()
    db.refresh(application)
    db.refresh(human)

    # Get products
    products = []
    for attendee in application.attendees:
        products.extend(attendee.products)

    custom = application.custom_fields or {}
    return GroupMemberPublic(
        id=human.id,
        first_name=human.first_name or "",
        last_name=human.last_name or "",
        email=human.email,
        telegram=human.telegram,
        organization=custom.get("organization"),
        role=custom.get("role"),
        gender=human.gender,
        local_resident=None,
        products=products,
    )


@router.post(
    "/my/{group_id}/members/batch",
    response_model=list[GroupMemberBatchResult],
    status_code=status.HTTP_207_MULTI_STATUS,
)
async def add_group_members_batch(
    group_id: uuid.UUID,
    batch: GroupMemberBatch,
    db: SessionDep,
    current_human: CurrentHuman,
) -> list[GroupMemberBatchResult]:
    """Add multiple members to a group (Portal - leader only)."""
    from loguru import logger

    group = crud.groups_crud.get(db, group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    _check_leader_permission(group, current_human.id)

    results = []
    for member in batch.members:
        try:
            # Use the same logic as single member add
            result = await add_group_member(group_id, member, db, current_human)
            results.append(
                GroupMemberBatchResult(
                    **result.model_dump(),
                    success=True,
                    err_msg=None,
                )
            )
        except HTTPException as e:
            logger.warning(f"Failed to add member {member.email}: {e.detail}")
            results.append(
                GroupMemberBatchResult(
                    id=uuid.uuid4(),  # Placeholder
                    first_name=member.first_name,
                    last_name=member.last_name,
                    email=member.email,
                    telegram=member.telegram,
                    gender=member.gender,
                    local_resident=member.local_resident,
                    products=[],
                    success=False,
                    err_msg=str(e.detail),
                )
            )
        except Exception as e:
            logger.error(f"Error adding member {member.email}: {e}")
            raise

    return results


@router.put("/my/{group_id}/members/{human_id}", response_model=GroupMemberPublic)
async def update_group_member(
    group_id: uuid.UUID,
    human_id: uuid.UUID,
    member_in: GroupMemberUpdate,
    db: SessionDep,
    current_human: CurrentHuman,
) -> GroupMemberPublic:
    """Update a member in a group (Portal - leader only)."""
    from app.api.application.crud import applications_crud

    group = crud.groups_crud.get(db, group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    _check_leader_permission(group, current_human.id)

    # Check if human is a member
    if not crud.groups_crud.is_member(db, group.id, human_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found in group",
        )

    # Get application and human
    application = applications_crud.get_by_human_popup(db, human_id, group.popup_id)
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    # Update human profile fields (not application)
    from app.api.human.crud import humans_crud

    human = humans_crud.get(db, human_id)
    if not human:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )

    update_data = member_in.model_dump(exclude_unset=True)
    # Remove local_resident as it doesn't exist on Human model
    update_data.pop("local_resident", None)
    for field, value in update_data.items():
        setattr(human, field, value)

    db.add(human)
    db.commit()
    db.refresh(human)

    # Get products
    products = []
    for attendee in application.attendees:
        products.extend(attendee.products)

    custom = application.custom_fields or {}
    return GroupMemberPublic(
        id=human_id,
        first_name=human.first_name or "",
        last_name=human.last_name or "",
        email=human.email,
        telegram=human.telegram,
        organization=custom.get("organization"),
        role=custom.get("role"),
        gender=human.gender,
        local_resident=None,
        products=products,
    )


@router.delete(
    "/my/{group_id}/members/{human_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_group_member(
    group_id: uuid.UUID,
    human_id: uuid.UUID,
    db: SessionDep,
    current_human: CurrentHuman,
) -> None:
    """Remove a member from a group (Portal - leader only)."""
    from app.api.application.crud import applications_crud

    group = crud.groups_crud.get(db, group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    _check_leader_permission(group, current_human.id)

    # Check if human is a member
    if not crud.groups_crud.is_member(db, group.id, human_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found in group",
        )

    # Block removal if the member already purchased — their products are tied
    # to the application and removing the discount eligibility post-purchase is
    # meaningless (price is already consolidated in payment).
    application = applications_crud.get_by_human_popup(db, human_id, group.popup_id)
    if application:
        for attendee in application.attendees:
            if attendee.products:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot remove member with purchased products",
                )

    # Remove from vigente membership only. Application.group_id is preserved as
    # historical record of where this application originated.
    crud.groups_crud.remove_member(db, group.id, human_id)
    db.commit()


def _add_member_by_application_logic(
    db: "Session",
    group: "Groups",
    request: "AddMemberByApplicationRequest",
) -> tuple["GroupMemberPublic", bool]:
    """Core logic for POST .../members/by-application.

    Returns (GroupMemberPublic, created) where created=True means the row was
    inserted (201), created=False means the human was already a member (200).

    Raises HTTPException on validation failures.
    """
    from sqlmodel import select

    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus
    from app.api.human.models import Humans

    # Fetch the application
    application = db.exec(
        select(Applications).where(Applications.id == request.application_id)
    ).first()
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    # Application must belong to the same popup as the group
    if application.popup_id != group.popup_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Application does not belong to the same popup as this group",
        )

    # Application must be ACCEPTED
    if application.status != ApplicationStatus.ACCEPTED.value:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Application must be in ACCEPTED status to add human as group member",
        )

    human_id = application.human_id
    human = db.exec(select(Humans).where(Humans.id == human_id)).first()
    if not human:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )

    # Idempotency: if already a member, return current state (200)
    already_member = crud.groups_crud.is_member(db, group.id, human_id)
    if not already_member:
        from sqlalchemy import func as _func
        from sqlmodel import select as _select

        from app.api.group.models import GroupMembers

        # Cap check: reject if group is full
        if group.max_members is not None:
            current_count = db.exec(
                _select(_func.count(GroupMembers.human_id)).where(
                    GroupMembers.group_id == group.id
                )
            ).one()
            if current_count >= group.max_members:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Group has reached its maximum member limit",
                )

        member_row = GroupMembers(
            tenant_id=group.tenant_id,
            group_id=group.id,
            human_id=human_id,
        )
        db.add(member_row)
        db.commit()

    # Build response
    custom = (application.custom_fields or {}) if application.custom_fields else {}
    products: list = []
    for attendee in application.attendees:
        products.extend(attendee.products)

    member_public = GroupMemberPublic(
        id=human.id,
        first_name=human.first_name or "",
        last_name=human.last_name or "",
        email=human.email,
        telegram=human.telegram,
        organization=custom.get("organization"),
        role=custom.get("role"),
        gender=human.gender,
        local_resident=None,
        products=products,
    )
    return member_public, not already_member


@router.post(
    "/{group_id}/members/by-application",
    response_model=GroupMemberPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Add an approved human to a group by application (admin)",
)
async def add_member_by_application_admin(
    group_id: uuid.UUID,
    request: AddMemberByApplicationRequest,
    db: AdminOrApiKeySession_GroupsWrite,
    _: AdminOrApiKey_GroupsWrite,
) -> GroupMemberPublic:
    """Add an existing approved human to a group without creating a duplicate application.

    Guard: admin token (backoffice). For portal leaders, use /my/{group_id}/members/by-application.
    The application must belong to the same popup as the group and have ACCEPTED status.
    Idempotent: returns 200 if the human is already a member.
    """
    group = crud.groups_crud.get(db, group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    member_public, created = _add_member_by_application_logic(db, group, request)
    # Override FastAPI's default 201 with 200 when not created (already member)
    if not created:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content=member_public.model_dump(mode="json"),
        )  # type: ignore[return-value]
    return member_public


@router.post(
    "/my/{group_id}/members/by-application",
    response_model=GroupMemberPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Add an approved human to a group by application (leader)",
)
async def add_member_by_application_leader(
    group_id: uuid.UUID,
    request: AddMemberByApplicationRequest,
    db: SessionDep,
    current_human: CurrentHuman,
) -> GroupMemberPublic:
    """Add an existing approved human to a group without creating a duplicate application.

    Guard: portal leader token. For admin, use /{group_id}/members/by-application.
    The application must belong to the same popup as the group and have ACCEPTED status.
    Idempotent: returns 200 if the human is already a member.
    """
    group = crud.groups_crud.get(db, group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    _check_leader_permission(group, current_human.id)

    member_public, created = _add_member_by_application_logic(db, group, request)
    if not created:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content=member_public.model_dump(mode="json"),
        )  # type: ignore[return-value]
    return member_public


@router.get("/public/{group_slug}", response_model=GroupPublic)
async def get_group_public(
    group_slug: str,
    db: SessionDep,
) -> GroupPublic:
    """Get a group by slug (public - for invite links)."""
    group = crud.groups_crud.get_by_slug(db, group_slug)

    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )

    return GroupPublic.model_validate(group)


# ---------------------------------------------------------------------------
# Portal URL compat layer — T-gr-043, T-gr-044
# Spec: REQ-GR-027, REQ-GR-028
# Design: Decision 1e — GroupSlugResolution with kind discriminator
# ---------------------------------------------------------------------------

portal_router = APIRouter(prefix="/portal", tags=["portal"])


@portal_router.get(
    "/groups/{slug}",
    response_model=GroupSlugResolution,
    summary="Resolve group slug or invite token (URL compat layer)",
)
async def resolve_group_slug(
    slug: str,
    popup_id: uuid.UUID,
    db: SessionDep,
) -> GroupSlugResolution:
    """Resolve /portal/groups/{slug} to either a group or an invite.

    Resolution order (Design: Decision 1e):
      1. Look up groups by slug within the popup → kind="group"
      2. Look up invites by token within the popup → kind="invite"
      3. 404 if neither found

    Legacy email links that land on /groups/{slug} can be transparently
    redirected to /invite/{token} by the portal when kind="invite".

    Spec: REQ-GR-027 — fallback resolver for post-migration invite tokens.
    """
    from app.api.invite.crud import invites_crud
    from app.api.invite.schemas import InvitePublicPreview

    # Step 1: resolve as a group slug
    group = crud.groups_crud.get_by_slug(db, slug, popup_id=popup_id)
    if group:
        return GroupSlugResolution(
            kind="group",
            group=GroupPublic.model_validate(group),
            invite=None,
        )

    # Step 2: resolve as an invite token (migrated EE26 groups land here)
    invite = invites_crud.get_by_token(db, popup_id=popup_id, token=slug)
    if invite:
        # Resolve inviter_name for the preview payload
        from sqlmodel import select as _select

        from app.api.user.models import Users

        inviter_name: str | None = None
        creator = db.exec(_select(Users).where(Users.id == invite.created_by)).first()
        if creator:
            inviter_name = creator.full_name or creator.email

        preview = InvitePublicPreview(
            popup_id=invite.popup_id,
            token=invite.token,
            inviter_name=inviter_name,
            is_email_restricted=invite.recipient_email is not None,
            discount_percentage=invite.discount_percentage,
            max_uses=invite.max_uses,
            current_uses=invite.current_uses,
            expires_at=invite.expires_at,
        )
        return GroupSlugResolution(
            kind="invite",
            group=None,
            invite=preview.model_dump(mode="json"),
        )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Group or invite not found",
    )


@portal_router.get(
    "/invite/{token}",
    response_model=None,
    summary="Canonical invite forward endpoint (redirect to redeem preview)",
)
async def canonical_invite_forward(
    token: str,
    db: SessionDep,
) -> "InvitePublicPreview":
    """Canonical forward endpoint for invite URLs.

    This is the preferred URL for invite links going forward. It is a thin
    proxy to GET /invites/redeem/{token} preview semantics.

    Spec: REQ-GR-028 — /invite/{token} as canonical portal endpoint.
    Design: Decision 1e — both /groups/{slug} (compat) and /invite/{token}
    (canonical) support redemption during the migration window.
    """
    from app.api.invite.crud import invites_crud
    from app.api.invite.schemas import InvitePublicPreview

    invite = invites_crud.get_by_token_any_popup(db, token)
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found"
        )

    # Apply guard chain for preview (expired/exhausted → 410 Gone)
    invites_crud.validate_for_redemption(invite)

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
