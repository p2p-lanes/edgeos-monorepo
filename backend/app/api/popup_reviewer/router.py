import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import Column
from sqlmodel import Session, select

from app.api.popup_reviewer.crud import popup_reviewers_crud
from app.api.popup_reviewer.models import PopupReviewers
from app.api.popup_reviewer.schemas import (
    PopupReviewerCreate,
    PopupReviewerPublic,
    PopupReviewerUpdate,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.user.models import Users
from app.core.dependencies.users import (
    CurrentAdmin,
    CurrentWriter,
    SessionDep,
    TenantSession,
)

router = APIRouter(prefix="/popups", tags=["popup-reviewers"])


def _reviewer_to_public(
    reviewer: PopupReviewers,
    user: Users | None,
) -> PopupReviewerPublic:
    """Convert reviewer to public schema with pre-fetched user details."""
    return PopupReviewerPublic(
        id=reviewer.id,
        popup_id=reviewer.popup_id,
        user_id=reviewer.user_id,
        tenant_id=reviewer.tenant_id,
        flow_id=reviewer.flow_id,
        is_required=reviewer.is_required,
        weight_multiplier=reviewer.weight_multiplier,
        created_at=reviewer.created_at,
        user_email=user.email if user else None,
        user_full_name=user.full_name if user else None,
    )


def _get_flow_or_404(db: TenantSession, popup_id: uuid.UUID, flow_id: uuid.UUID):
    """Verify a sales flow exists and belongs to this popup (sdd/sales-flows D4)."""
    from app.api.sales_flow.crud import sales_flows_crud

    flow = sales_flows_crud.get(db, flow_id)
    if not flow or flow.popup_id != popup_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sales flow not found for this popup",
        )
    return flow


def _fetch_users_by_ids(
    session: Session, user_ids: list[uuid.UUID]
) -> dict[uuid.UUID, Users]:
    """Fetch users by id in a single query, returning a {user_id: user} map.

    Users table is not tenant-scoped — use the main session.
    """
    if not user_ids:
        return {}
    id_col: Column = Users.id  # ty:ignore[invalid-assignment]
    statement = select(Users).where(id_col.in_(user_ids))
    return {u.id: u for u in session.exec(statement).all()}


@router.get("/{popup_id}/reviewers", response_model=ListModel[PopupReviewerPublic])
async def list_reviewers(
    popup_id: uuid.UUID,
    db: TenantSession,
    session: SessionDep,
    _: CurrentAdmin,
    flow_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[PopupReviewerPublic]:
    """List designated reviewers for a popup.

    Without `flow_id`, returns the popup-shared tier only (sdd/sales-flows
    D4) — identical to this popup's reviewer list before this slice. With
    `flow_id`, returns the RESOLVED reviewer set for that flow per its
    `reviewers_mode` (inherit -> popup-shared tier; override -> only that
    flow's own rows, possibly empty).
    """
    from app.api.popup.crud import popups_crud

    # Verify popup exists
    popup = popups_crud.get(db, popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    if flow_id is not None:
        _get_flow_or_404(db, popup_id, flow_id)
        resolved = popup_reviewers_crud.resolve_for_flow(db, popup_id, flow_id)
        total = len(resolved)
        reviewers = resolved[skip : skip + limit]
    else:
        reviewers, total = popup_reviewers_crud.find_popup_shared(
            db, popup_id, skip, limit
        )

    users_by_id = _fetch_users_by_ids(session, [r.user_id for r in reviewers])

    return ListModel[PopupReviewerPublic](
        results=[_reviewer_to_public(r, users_by_id.get(r.user_id)) for r in reviewers],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post(
    "/{popup_id}/reviewers",
    response_model=PopupReviewerPublic,
    status_code=status.HTTP_201_CREATED,
)
async def add_reviewer(
    popup_id: uuid.UUID,
    reviewer_in: PopupReviewerCreate,
    db: TenantSession,
    session: SessionDep,
    _current_user: CurrentWriter,
) -> PopupReviewerPublic:
    """Add a reviewer to a popup, or to one specific sales flow of that
    popup when `reviewer_in.flow_id` is set (sdd/sales-flows D4)."""
    from app.api.popup.crud import popups_crud
    from app.api.user.crud import users_crud

    # Verify popup exists
    popup = popups_crud.get(db, popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    if reviewer_in.flow_id is not None:
        _get_flow_or_404(db, popup_id, reviewer_in.flow_id)

    # Verify user exists and has appropriate role (use main session for users table)
    user = users_crud.get(session, reviewer_in.user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Ensure user belongs to the same tenant as the popup
    if user.tenant_id != popup.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User does not belong to this tenant",
        )

    if user.role not in [UserRole.ADMIN, UserRole.SUPERADMIN]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only ADMIN or SUPERADMIN users can be reviewers",
        )

    # Check if already a reviewer at this tier
    existing = popup_reviewers_crud.get_by_popup_user(
        db, popup_id, reviewer_in.user_id, flow_id=reviewer_in.flow_id
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already a reviewer for this popup",
        )

    reviewer = popup_reviewers_crud.create_reviewer(
        db, popup_id, popup.tenant_id, reviewer_in
    )

    return _reviewer_to_public(reviewer, user)


@router.patch("/{popup_id}/reviewers/{user_id}", response_model=PopupReviewerPublic)
async def update_reviewer(
    popup_id: uuid.UUID,
    user_id: uuid.UUID,
    reviewer_in: PopupReviewerUpdate,
    db: TenantSession,
    session: SessionDep,
    _current_user: CurrentWriter,
    flow_id: uuid.UUID | None = None,
) -> PopupReviewerPublic:
    """Update a reviewer's settings.

    `flow_id` selects the tier (sdd/sales-flows D4): omitted targets the
    popup-shared reviewer, provided targets that flow's own reviewer row.
    """
    from app.api.popup.crud import popups_crud
    from app.api.user.crud import users_crud

    # Verify popup exists
    popup = popups_crud.get(db, popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    reviewer = popup_reviewers_crud.get_by_popup_user(
        db, popup_id, user_id, flow_id=flow_id
    )
    if not reviewer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reviewer not found",
        )

    reviewer = popup_reviewers_crud.update(db, reviewer, reviewer_in)
    user = users_crud.get(session, reviewer.user_id)
    return _reviewer_to_public(reviewer, user)


@router.delete(
    "/{popup_id}/reviewers/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_reviewer(
    popup_id: uuid.UUID,
    user_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentWriter,
    flow_id: uuid.UUID | None = None,
) -> None:
    """Remove a reviewer from a popup.

    `flow_id` selects the tier (sdd/sales-flows D4). Removing the last
    flow-tier reviewer for a flow resets that flow's `reviewers_mode` back
    to 'inherit'.
    """
    from app.api.popup.crud import popups_crud

    # Verify popup exists
    popup = popups_crud.get(db, popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    reviewer = popup_reviewers_crud.get_by_popup_user(
        db, popup_id, user_id, flow_id=flow_id
    )
    if not reviewer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reviewer not found",
        )

    popup_reviewers_crud.delete_reviewer(db, reviewer)
