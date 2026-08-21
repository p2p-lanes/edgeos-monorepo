import uuid

from fastapi import APIRouter, HTTPException, status
from loguru import logger
from sqlmodel import select

from app.api.application_review.crud import (
    application_review_skips_crud,
    application_reviews_crud,
)
from app.api.application_review.schemas import (
    ApplicationReviewCreate,
    ApplicationReviewPublic,
    ApplicationReviewSkipCreate,
    ApplicationReviewSkipPublic,
    ApplicationReviewUpdate,
    ReviewDecision,
    ReviewSummary,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.user.models import Users
from app.core.db import engine
from app.core.dependencies.users import CurrentOperator, TenantSession
from app.services.email_helpers import send_application_status_email

router = APIRouter(prefix="/applications", tags=["application-reviews"])


async def _send_status_email_best_effort(
    application, db, *, status_before: str
) -> None:
    """Notify after commit without making a successful vote look rolled back."""
    if not application.human:
        return
    try:
        await send_application_status_email(
            application,
            application.human,
            db,
            status_before=status_before,
        )
    except Exception:
        logger.exception(
            "Failed to send application status email after review mutation {}",
            application.id,
        )


def _review_to_public(
    review, reviewer_email: str | None = None, reviewer_full_name: str | None = None
) -> ApplicationReviewPublic:
    """Convert review to public schema with reviewer details.

    Reviewer details are passed explicitly to avoid accessing the users table
    through the relationship, which tenant credentials don't have access to.
    """
    return ApplicationReviewPublic(
        id=review.id,
        application_id=review.application_id,
        reviewer_id=review.reviewer_id,
        tenant_id=review.tenant_id,
        decision=review.decision,
        notes=review.notes,
        created_at=review.created_at,
        updated_at=review.updated_at,
        reviewer_email=reviewer_email,
        reviewer_full_name=reviewer_full_name,
    )


def _get_reviewer_details(reviewer_ids: list[uuid.UUID]) -> dict[uuid.UUID, Users]:
    """Fetch reviewer details from users table using main engine.

    Tenant sessions don't have access to the users table, so we use
    the main engine to fetch reviewer details.
    """
    if not reviewer_ids:
        return {}

    from sqlalchemy import Column
    from sqlmodel import Session

    with Session(engine) as session:
        id_col: Column = Users.id  # ty:ignore[invalid-assignment]
        statement = select(Users).where(id_col.in_(reviewer_ids))
        users = session.exec(statement).all()
        return {user.id: user for user in users}


def _reviews_to_public_list(reviews: list) -> list[ApplicationReviewPublic]:
    """Convert multiple reviews to public schema, fetching reviewer details in batch."""
    if not reviews:
        return []

    reviewer_ids = [r.reviewer_id for r in reviews]
    reviewers = _get_reviewer_details(reviewer_ids)

    return [
        _review_to_public(
            r,
            reviewer_email=reviewers.get(r.reviewer_id, Users()).email,
            reviewer_full_name=reviewers.get(r.reviewer_id, Users()).full_name,
        )
        for r in reviews
    ]


@router.get(
    "/{application_id}/reviews", response_model=ListModel[ApplicationReviewPublic]
)
async def list_reviews(
    application_id: uuid.UUID,
    db: TenantSession,
    _: CurrentOperator,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[ApplicationReviewPublic]:
    """List reviews for an application."""
    from app.api.application.crud import applications_crud

    # Verify application exists
    application = applications_crud.get(db, application_id)
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    reviews, total = application_reviews_crud.find_by_application(
        db, application_id, skip, limit
    )

    return ListModel[ApplicationReviewPublic](
        results=_reviews_to_public_list(reviews),
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{application_id}/reviews/summary", response_model=ReviewSummary)
async def get_review_summary(
    application_id: uuid.UUID,
    db: TenantSession,
    _: CurrentOperator,
) -> ReviewSummary:
    """Get a summary of reviews for an application."""
    from app.api.application.crud import applications_crud
    from app.api.approval_strategy.crud import approval_strategies_crud
    from app.api.approval_strategy.schemas import ApprovalStrategyType

    # Verify application exists
    application = applications_crud.get(db, application_id)
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    # Get reviews for display and counts using SQL aggregation
    reviews = application_reviews_crud.find_all_by_application(db, application_id)
    counts = application_reviews_crud.count_by_decision(db, application_id)

    # Calculate weighted score using SQL aggregation if applicable
    weighted_score = None
    strategy = approval_strategies_crud.get_by_popup(db, application.popup_id)
    if strategy and strategy.strategy_type == ApprovalStrategyType.WEIGHTED:
        weighted_score = application_reviews_crud.calculate_weighted_score(
            db,
            application_id,
            strong_yes_weight=strategy.strong_yes_weight,
            yes_weight=strategy.yes_weight,
            no_weight=strategy.no_weight,
            strong_no_weight=strategy.strong_no_weight,
        )

    return ReviewSummary(
        total_reviews=len(reviews),
        strong_yes_count=counts[ReviewDecision.STRONG_YES],
        yes_count=counts[ReviewDecision.YES],
        no_count=counts[ReviewDecision.NO],
        strong_no_count=counts[ReviewDecision.STRONG_NO],
        weighted_score=weighted_score,
        reviews=_reviews_to_public_list(reviews),
    )


@router.post(
    "/{application_id}/reviews",
    response_model=ApplicationReviewPublic,
    status_code=status.HTTP_201_CREATED,
)
async def submit_review(
    application_id: uuid.UUID,
    review_in: ApplicationReviewCreate,
    db: TenantSession,
    current_user: CurrentOperator,
) -> ApplicationReviewPublic:
    """Create the current user's review while the application is open."""
    from app.api.application.crud import _maybe_grant_fee_credit
    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus
    from app.services.approval.calculator import approval_calculator

    # Every review mutation locks the application first. This serializes votes
    # and status calculation and prevents a stale detail page from modifying a
    # decision that another reviewer has already finalized.
    application = db.exec(
        select(Applications).where(Applications.id == application_id).with_for_update()
    ).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if application.status != ApplicationStatus.IN_REVIEW.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "application_not_in_review",
                "message": "Reviews can only be submitted while the application is in review.",
                "application_status": application.status,
            },
        )

    existing = application_reviews_crud.get_by_application_reviewer(
        db, application_id, current_user.id
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "review_already_exists",
                "message": "You already reviewed this application. Change it from the application detail.",
            },
        )

    tenant_id = (
        application.tenant_id
        if current_user.role == UserRole.SUPERADMIN
        else current_user.tenant_id
    )
    if not tenant_id:
        raise HTTPException(status_code=403, detail="User has no tenant assigned")

    status_before = application.status
    review = application_reviews_crud.create_review(
        db, application_id, current_user.id, tenant_id, review_in
    )
    updated_application = approval_calculator.recalculate_status(db, application)
    _maybe_grant_fee_credit(db, updated_application)
    db.commit()
    db.refresh(review)
    db.refresh(updated_application)

    await _send_status_email_best_effort(
        updated_application, db, status_before=status_before
    )

    return _review_to_public(review, current_user.email, current_user.full_name)


@router.patch(
    "/{application_id}/reviews/me",
    response_model=ApplicationReviewPublic,
)
async def change_my_review(
    application_id: uuid.UUID,
    review_in: ApplicationReviewUpdate,
    db: TenantSession,
    current_user: CurrentOperator,
) -> ApplicationReviewPublic:
    """Change the current user's vote while the application remains in review."""
    from app.api.application.crud import _maybe_grant_fee_credit
    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus
    from app.api.audit_log.actor import actor_from_user
    from app.api.audit_log.constants import AuditAction, AuditEntityType
    from app.api.audit_log.crud import audit_logs_crud
    from app.services.approval.calculator import approval_calculator

    application = db.exec(
        select(Applications).where(Applications.id == application_id).with_for_update()
    ).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    if application.status != ApplicationStatus.IN_REVIEW.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "application_no_longer_in_review",
                "message": "This application was finalized while you were editing. Its review can no longer be changed.",
                "application_status": application.status,
            },
        )

    review = application_reviews_crud.get_by_application_reviewer(
        db, application_id, current_user.id
    )
    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You have not reviewed this application yet",
        )
    if (
        review_in.expected_updated_at is not None
        and review.updated_at != review_in.expected_updated_at
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "review_changed",
                "message": "Your review changed in another session. Refresh and try again.",
            },
        )

    old_decision = review.decision
    if old_decision == review_in.decision:
        return _review_to_public(review, current_user.email, current_user.full_name)

    status_before = application.status
    application_reviews_crud.change_decision(db, review, review_in.decision)
    updated_application = approval_calculator.recalculate_status(db, application)
    _maybe_grant_fee_credit(db, updated_application)

    human = application.human
    human_name = None
    if human:
        human_name = (
            f"{human.first_name or ''} {human.last_name or ''}".strip() or human.email
        )
    audit_logs_crud.record(
        db,
        tenant_id=application.tenant_id,
        actor=actor_from_user(current_user),
        action=AuditAction.APPLICATION_REVIEW_CHANGED,
        entity_type=AuditEntityType.APPLICATION,
        entity_id=application.id,
        entity_label=human_name,
        popup_id=application.popup_id,
        details={
            "review_id": str(review.id),
            "old_decision": old_decision.value,
            "new_decision": review_in.decision.value,
            "old_status": status_before,
            "new_status": updated_application.status,
        },
    )
    db.commit()
    db.refresh(review)
    db.refresh(updated_application)

    await _send_status_email_best_effort(
        updated_application, db, status_before=status_before
    )

    return _review_to_public(review, current_user.email, current_user.full_name)


@router.get("/pending-review", response_model=ListModel)
async def list_pending_reviews(
    db: TenantSession,
    current_user: CurrentOperator,
    popup_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
):
    """List applications pending review by the current user.

    Returns IN_REVIEW applications the user has not yet reviewed.
    If the user is a designated reviewer, scopes to their assigned popups.
    Otherwise (admin without reviewer assignment), returns all IN_REVIEW
    applications they haven't reviewed yet.
    """
    from app.api.application.crud import applications_crud
    from app.api.application.router import _build_application_public
    from app.api.popup_reviewer.crud import popup_reviewers_crud

    reviewer_assignments = popup_reviewers_crud.find_by_user(db, current_user.id)

    if reviewer_assignments:
        popup_ids = [r.popup_id for r in reviewer_assignments]
        if popup_id and popup_id in popup_ids:
            popup_ids = [popup_id]
        elif popup_id:
            return ListModel(
                results=[],
                paging=Paging(offset=skip, limit=limit, total=0),
            )
    else:
        popup_ids = [popup_id] if popup_id else None

    pending_apps, total = applications_crud.find_pending_review(
        db,
        reviewer_id=current_user.id,
        popup_ids=popup_ids,
        skip=skip,
        limit=limit,
    )

    skip_reasons = application_review_skips_crud.get_skip_reasons_by_application(
        db, [a.id for a in pending_apps], current_user.id
    )

    return ListModel(
        results=[
            _build_application_public(
                a,
                skipped_by_me=a.id in skip_reasons,
                my_skip_reason=skip_reasons.get(a.id),
            )
            for a in pending_apps
        ],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/my-reviews", response_model=ListModel[ApplicationReviewPublic])
async def list_my_reviews(
    db: TenantSession,
    current_user: CurrentOperator,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[ApplicationReviewPublic]:
    """List reviews submitted by the current user."""

    reviews, total = application_reviews_crud.find_by_reviewer(
        db, current_user.id, skip, limit
    )

    return ListModel[ApplicationReviewPublic](
        results=[_review_to_public(r) for r in reviews],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post(
    "/{application_id}/skip",
    response_model=ApplicationReviewSkipPublic,
    status_code=status.HTTP_201_CREATED,
)
async def skip_application(
    application_id: uuid.UUID,
    skip_in: ApplicationReviewSkipCreate,
    db: TenantSession,
    current_user: CurrentOperator,
) -> ApplicationReviewSkipPublic:
    """Skip an application: drop it from your own pending queue without voting.

    Idempotent — skipping again updates the reason. Never affects the tally.
    """
    from app.api.application.crud import applications_crud

    application = applications_crud.get(db, application_id)
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    tenant_id = current_user.tenant_id
    if current_user.role == UserRole.SUPERADMIN:
        tenant_id = application.tenant_id
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User has no tenant assigned",
        )

    skip = application_review_skips_crud.upsert_skip(
        db, application_id, current_user.id, tenant_id, skip_in
    )
    return ApplicationReviewSkipPublic.model_validate(skip)


@router.delete(
    "/{application_id}/skip",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unskip_application(
    application_id: uuid.UUID,
    db: TenantSession,
    current_user: CurrentOperator,
) -> None:
    """Un-skip an application: return it to your pending queue."""
    from app.api.application.crud import applications_crud

    application = applications_crud.get(db, application_id)
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    application_review_skips_crud.delete_skip(db, application_id, current_user.id)
