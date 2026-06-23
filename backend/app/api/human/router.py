import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status

from app.api.api_key import crud as api_key_crud
from app.api.api_key.schemas import ApiKeyPublic
from app.api.audit_log.actor import actor_from_user
from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.crud import audit_logs_crud
from app.api.human import crud
from app.api.human.activity_crud import build_human_activity, note_log_to_item
from app.api.human.activity_schemas import HumanActivityCreate, HumanActivityItem
from app.api.human.crud import HardDeleteSummary
from app.api.human.models import HumanComment
from app.api.human.schemas import (
    HumanCommentCreate,
    HumanCommentPublic,
    HumanCommentUpdate,
    HumanCreate,
    HumanPortalPublic,
    HumanProfileStats,
    HumanProfileUpdate,
    HumanPublic,
    HumanUpdate,
)
from app.api.shared.enums import HumanRating, UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    AdminOrApiKey_HumansRead,
    AdminOrApiKey_HumansWrite,
    AdminOrApiKeySession_HumansRead,
    AdminOrApiKeySession_HumansWrite,
    CurrentAdmin,
    CurrentHuman,
    CurrentSuperadmin,
    CurrentUser,
    HumanTenantSession,
    SessionDep,
    TenantSession,
    needs,
)
from app.services.email_helpers import send_application_status_email

router = APIRouter(prefix="/humans", tags=["humans"])


@router.get("", response_model=ListModel[HumanPublic])
async def list_humans(
    db: AdminOrApiKeySession_HumansRead,
    _: AdminOrApiKey_HumansRead,
    search: str | None = None,
    popup_id: uuid.UUID | None = None,
    incomplete_application: bool = False,
    email: str | None = None,
    telegram: str | None = None,
    gender: str | None = None,
    age: str | None = None,
    residence: str | None = None,
    rating: HumanRating | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[HumanPublic]:
    if incomplete_application:
        if popup_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="popup_id is required when filtering incomplete applications",
            )
        humans, total = crud.find_with_incomplete_application(
            db,
            skip=skip,
            limit=limit,
            search=search,
            popup_id=popup_id,
        )
    else:
        humans, total = crud.find_filtered(
            db,
            skip=skip,
            limit=limit,
            search=search,
            email=email,
            telegram=telegram,
            gender=gender,
            age=age,
            residence=residence,
            rating=rating.value if rating else None,
        )

    return ListModel[HumanPublic](
        results=[HumanPublic.model_validate(h) for h in humans],
        paging=Paging(
            offset=skip,
            limit=limit,
            total=total,
        ),
    )


@router.post("", response_model=HumanPublic, status_code=status.HTTP_201_CREATED)
async def create_human(
    human_in: HumanCreate,
    db: TenantSession,
    current_user: CurrentSuperadmin,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> HumanPublic:
    """Create a human (superadmin only, for testing purposes).

    The CurrentSuperadmin dep enforces the superadmin gate; the former inline
    _check_superadmin() call is removed as redundant.
    """

    # Check if human with this email already exists
    existing = crud.get_by_email(db, human_in.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Human with this email already exists",
        )

    # Resolve tenant_id: superadmins must provide X-Tenant-Id header,
    # regular users use their own tenant_id (though currently only superadmins reach here)
    tenant_id: uuid.UUID | None = None
    if x_tenant_id:
        tenant_id = uuid.UUID(x_tenant_id)
    elif current_user.tenant_id:
        tenant_id = current_user.tenant_id

    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant context required",
        )

    human = crud.create_internal(db, human_in, tenant_id)
    return HumanPublic.model_validate(human)


@router.get(
    "/me",
    response_model=HumanPublic,
    summary="Get your profile",
    dependencies=[needs("portal:profile:read")],
)
async def get_current_human_info(
    current_user: CurrentHuman,
) -> HumanPublic:
    return HumanPublic.model_validate(current_user)


@router.get(
    "/me/profile-stats",
    response_model=HumanProfileStats,
    summary="Get your profile stats",
    dependencies=[needs("portal:profile:read")],
)
async def get_current_human_profile_stats(
    current_human: CurrentHuman,
    db: HumanTenantSession,
) -> HumanProfileStats:
    """Aggregate popup history and total days attended for the profile page."""
    return crud.get_profile_stats(db, current_human.id)


@router.patch(
    "/me",
    response_model=HumanPublic,
    summary="Update your profile",
    dependencies=[needs("portal:profile:write")],
)
async def update_current_human(
    human_in: HumanProfileUpdate,
    current_human: CurrentHuman,
    db: HumanTenantSession,
) -> HumanPublic:
    """Update the current authenticated human's profile."""
    human = crud.get(db, current_human.id)

    if not human:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )

    updated = crud.update(db, human, human_in)
    return HumanPublic.model_validate(updated)


@router.get(
    "/portal/search",
    response_model=ListModel[HumanPortalPublic],
    summary="Search participants directory",
    dependencies=[needs("portal:directory:read")],
)
async def search_humans_portal(
    db: HumanTenantSession,
    _: CurrentHuman,
    popup_id: uuid.UUID,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 20,
) -> ListModel[HumanPortalPublic]:
    """Search a popup's attendees who share their name, for portal pickers.

    Used by the event-creation Displayed-host field to let a creator pick a
    host. Scoped to humans who actually attend ``popup_id`` (accepted
    application with a ticket-holding main/spouse attendee) AND who have not
    hidden their name via ``info_not_shared`` for that popup. RLS scopes to the
    caller's tenant; the slim response schema omits email.
    """
    from app.api.application.crud import applications_crud

    humans, total = applications_crud.find_directory_humans(
        db,
        popup_id=popup_id,
        q=search,
        skip=skip,
        limit=limit,
    )
    return ListModel[HumanPortalPublic](
        results=[HumanPortalPublic.model_validate(h) for h in humans],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{human_id}", response_model=HumanPublic)
async def get_human(
    human_id: uuid.UUID,
    db: AdminOrApiKeySession_HumansRead,
    _: AdminOrApiKey_HumansRead,
) -> HumanPublic:
    human = crud.get(db, human_id)

    if not human:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )

    return HumanPublic.model_validate(human)


@router.patch("/{human_id}", response_model=HumanPublic)
async def update_human(
    human_id: uuid.UUID,
    human_in: HumanUpdate,
    db: AdminOrApiKeySession_HumansWrite,
    _current_user: AdminOrApiKey_HumansWrite,
) -> HumanPublic:
    human = crud.get(db, human_id)

    if not human:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )

    # Check if the rating is transitioning into RED_FLAG (the only level that
    # carries the blocking cascade). human.red_flag reflects the pre-update state.
    is_being_flagged = (
        human_in.rating == HumanRating.RED_FLAG and not human.red_flag
    )

    updated = crud.update(db, human, human_in)

    # If human is being flagged, auto-reject all their IN_REVIEW applications
    if is_being_flagged:
        from app.api.application.crud import applications_crud
        from app.api.application.schemas import ApplicationStatus

        api_key_crud.revoke_all_for_human(db, human_id)

        applications, _ = applications_crud.find_by_human(db, human_id)
        rejected_apps = []
        for app in applications:
            if app.status == ApplicationStatus.IN_REVIEW.value:
                app.status = ApplicationStatus.REJECTED.value
                db.add(app)
                applications_crud.create_snapshot(db, app, "auto_rejected")
                rejected_apps.append(app)
        db.commit()

        # Send rejection emails after commit so popup/tenant data is accessible
        for app in rejected_apps:
            db.refresh(app)
            if app.human:
                await send_application_status_email(app, app.human, db)

    return HumanPublic.model_validate(updated)


@router.post("/{human_id}/api-keys/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_human_api_keys(
    human_id: uuid.UUID,
    db: AdminOrApiKeySession_HumansWrite,
    _current_user: AdminOrApiKey_HumansWrite,
) -> None:
    human = crud.get(db, human_id)
    if not human:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )

    api_key_crud.revoke_all_for_human(db, human_id)


@router.delete(
    "/{human_id}",
    summary="Hard-delete a human and all related rows (admin or superadmin)",
)
async def delete_human(
    human_id: uuid.UUID,
    db: SessionDep,
    current_user: CurrentAdmin,
) -> HardDeleteSummary:
    """Permanently delete a Human with full cascade.

    Removes applications, attendees, payments, products, carts, group
    memberships, and ambassador-owned groups in a single transaction. Designed
    for cleaning up test users — destructive and irreversible.

    Superadmins may delete any human; a tenant admin may only delete humans
    within their own tenant. Both run on the control-plane session (which
    bypasses RLS), so the tenant ownership check is enforced explicitly here.
    """
    human = crud.get(db, human_id)
    if not human:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )
    # Tenant isolation: non-superadmins can only delete humans in their own
    # tenant. Respond 404 (not 403) so the existence of other tenants' humans
    # isn't revealed.
    if (
        current_user.role != UserRole.SUPERADMIN
        and human.tenant_id != current_user.tenant_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )
    return crud.hard_delete_cascade(db, human_id)


@router.get("/{human_id}/activity", response_model=ListModel[HumanActivityItem])
async def get_human_activity(
    human_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentAdmin,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 50,
) -> ListModel[HumanActivityItem]:
    """Aggregate a human's full activity timeline (admin-only).

    Built on read from applications, payments, attendees and manual notes; RLS
    on the TenantSession scopes every source query to the caller's tenant.
    """
    if not crud.get(db, human_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )
    items, total = build_human_activity(db, human_id, skip=skip, limit=limit)
    return ListModel[HumanActivityItem](
        results=items,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post(
    "/{human_id}/activity",
    response_model=HumanActivityItem,
    status_code=status.HTTP_201_CREATED,
)
async def create_human_activity(
    human_id: uuid.UUID,
    body: HumanActivityCreate,
    db: TenantSession,
    current_user: CurrentAdmin,
) -> HumanActivityItem:
    """Add a manual note to a human's timeline at an admin-chosen time.

    The note is stored in audit_logs (no migration); the chosen time lives in
    `details.occurred_at` while `created_at` stays the real write time.
    """
    human = crud.get(db, human_id)
    if not human:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )
    log = audit_logs_crud.record(
        db,
        tenant_id=human.tenant_id,
        actor=actor_from_user(current_user),
        action=AuditAction.HUMAN_NOTE_ADDED,
        entity_type=AuditEntityType.HUMAN,
        entity_id=human_id,
        entity_label=human.display_name,
        details={"note": body.note, "occurred_at": body.occurred_at.isoformat()},
    )
    db.commit()
    db.refresh(log)
    return note_log_to_item(log)


@router.get("/{human_id}/api-keys", response_model=list[ApiKeyPublic])
async def list_human_api_keys(
    human_id: uuid.UUID,
    db: AdminOrApiKeySession_HumansRead,
    _current_user: AdminOrApiKey_HumansRead,
) -> list[ApiKeyPublic]:
    human = crud.get(db, human_id)
    if not human:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )

    rows = api_key_crud.list_for_human(db, human_id)
    return [ApiKeyPublic.model_validate(row) for row in rows]


# --------------------------------------------------------------------------- #
# Comments — justify a human's rating. Mirrors the task comments model:
# any backoffice user can read/add, the author edits their own, the author or
# a superadmin soft-deletes. Scoped to the caller's tenant (superadmin bypass).
# --------------------------------------------------------------------------- #
def _get_human_in_tenant_or_404(db, human_id: uuid.UUID, current_user):  # noqa: ANN001
    """Load a human or 404, hiding humans outside the caller's tenant.

    Runs on the control-plane session (bypasses RLS), so the tenant ownership
    check is enforced explicitly — same pattern as the hard-delete endpoint.
    """
    human = crud.get(db, human_id)
    if not human or (
        current_user.role != UserRole.SUPERADMIN
        and human.tenant_id != current_user.tenant_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )
    return human


@router.get(
    "/{human_id}/comments", response_model=ListModel[HumanCommentPublic]
)
async def list_human_comments(
    human_id: uuid.UUID,
    db: SessionDep,
    current_user: CurrentUser,
) -> ListModel[HumanCommentPublic]:
    """List a human's comments, oldest first."""
    _get_human_in_tenant_or_404(db, human_id, current_user)
    comments = crud.list_comments(db, human_id)
    return ListModel[HumanCommentPublic](
        results=[HumanCommentPublic.model_validate(c) for c in comments],
        paging=Paging(offset=0, limit=len(comments), total=len(comments)),
    )


@router.post(
    "/{human_id}/comments",
    response_model=HumanCommentPublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_human_comment(
    human_id: uuid.UUID,
    comment_in: HumanCommentCreate,
    db: SessionDep,
    current_user: CurrentUser,
) -> HumanCommentPublic:
    """Add a comment to a human."""
    _get_human_in_tenant_or_404(db, human_id, current_user)
    comment = HumanComment(
        human_id=human_id,
        author_user_id=current_user.id,
        author_name=current_user.full_name,
        author_email=current_user.email,
        body=comment_in.body,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return HumanCommentPublic.model_validate(comment)


@router.put(
    "/{human_id}/comments/{comment_id}", response_model=HumanCommentPublic
)
async def update_human_comment(
    human_id: uuid.UUID,
    comment_id: uuid.UUID,
    comment_in: HumanCommentUpdate,
    db: SessionDep,
    current_user: CurrentUser,
) -> HumanCommentPublic:
    """Edit your own comment."""
    _get_human_in_tenant_or_404(db, human_id, current_user)
    comment = db.get(HumanComment, comment_id)
    if not comment or comment.human_id != human_id or comment.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found"
        )
    if comment.author_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own comments",
        )
    comment.body = comment_in.body
    comment.edited_at = datetime.now(UTC)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return HumanCommentPublic.model_validate(comment)


@router.delete(
    "/{human_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_human_comment(
    human_id: uuid.UUID,
    comment_id: uuid.UUID,
    db: SessionDep,
    current_user: CurrentUser,
) -> None:
    """Soft-delete a comment: the author, or any superadmin. Row is preserved."""
    _get_human_in_tenant_or_404(db, human_id, current_user)
    comment = db.get(HumanComment, comment_id)
    if not comment or comment.human_id != human_id or comment.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found"
        )
    if (
        current_user.role != UserRole.SUPERADMIN
        and comment.author_user_id != current_user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own comments",
        )
    comment.deleted_at = datetime.now(UTC)
    db.add(comment)
    db.commit()
