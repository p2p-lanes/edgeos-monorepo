"""Router for the backoffice scan-history endpoint.

Provides GET /check-ins with optional filtering by attendee_product_id and
popup_id. One row per scan event with full history.
"""

import uuid

from fastapi import APIRouter
from sqlalchemy.orm import selectinload
from sqlmodel import Session, func, select
from sqlmodel import select as sa_select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.check_in.models import CheckIn
from app.api.check_in.schemas import CheckInListItem
from app.api.product.models import Products
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.user.models import Users
from app.core.db import engine
from app.core.dependencies.users import CurrentCheckInOperator, TenantSession

router = APIRouter(prefix="/check-ins", tags=["check_in"])


@router.get("", response_model=ListModel[CheckInListItem])
async def list_check_ins(
    db: TenantSession,
    current_user: CurrentCheckInOperator,
    attendee_product_id: uuid.UUID | None = None,
    popup_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 50,
) -> ListModel[CheckInListItem]:
    """List check-ins with attendee + product names (BO only).

    Filters:
    - attendee_product_id: exact match on the ticket UUID
    - popup_id: exact match on the popup the scan happened in

    Ordered by occurred_at DESC. Tenant isolation is enforced both via the
    TenantSession (separate DB connection per tenant) and by an explicit
    tenant_id filter (defence-in-depth).
    """
    # Tenant filter — explicit defence-in-depth on top of TenantSession/RLS.
    # current_user.tenant_id is None only for superadmins, who get their own
    # TenantSession for the X-Tenant-Id header's tenant anyway.
    tenant_id_filter = current_user.tenant_id

    # Build base statement with eager loads to avoid N+1
    statement = select(CheckIn).options(
        selectinload(CheckIn.attendee_product).selectinload(AttendeeProducts.attendee),  # type: ignore[arg-type]  # type: ignore[arg-type]
        selectinload(CheckIn.attendee_product).selectinload(AttendeeProducts.product),  # type: ignore[arg-type]  # type: ignore[arg-type]
    )

    if tenant_id_filter is not None:
        statement = statement.where(CheckIn.tenant_id == tenant_id_filter)

    if attendee_product_id is not None:
        statement = statement.where(CheckIn.attendee_product_id == attendee_product_id)

    if popup_id is not None:
        statement = statement.where(CheckIn.popup_id == popup_id)

    # Count total rows for pagination
    count_statement = sa_select(func.count(CheckIn.id))
    if tenant_id_filter is not None:
        count_statement = count_statement.where(CheckIn.tenant_id == tenant_id_filter)
    if attendee_product_id is not None:
        count_statement = count_statement.where(
            CheckIn.attendee_product_id == attendee_product_id
        )
    if popup_id is not None:
        count_statement = count_statement.where(CheckIn.popup_id == popup_id)

    total = db.exec(count_statement).one()

    # Apply ordering and pagination to main statement
    statement = (
        statement.order_by(CheckIn.occurred_at.desc())  # type: ignore[union-attr]
        .offset(skip)
        .limit(limit)
    )

    events = list(db.exec(statement).all())

    # Resolve actor user details via the main engine — tenant_role lacks SELECT
    # on the users table by design. Mirrors the pattern used in
    # application_review/router._get_reviewer_details.
    actor_ids = {e.actor_user_id for e in events if e.actor_user_id is not None}
    actors_by_id: dict[uuid.UUID, Users] = {}
    if actor_ids:
        with Session(engine) as main_session:
            actor_id_col = Users.id  # ty:ignore[invalid-assignment]
            actor_rows = main_session.exec(
                select(Users).where(actor_id_col.in_(actor_ids))  # type: ignore[attr-defined]
            ).all()
            actors_by_id = {u.id: u for u in actor_rows}

    results = []
    for event in events:
        ap: AttendeeProducts | None = event.attendee_product  # type: ignore[attr-defined]
        attendee: Attendees | None = ap.attendee if ap else None  # type: ignore[union-attr]
        product: Products | None = ap.product if ap else None  # type: ignore[union-attr]
        actor = actors_by_id.get(event.actor_user_id) if event.actor_user_id else None

        source: str | None = None
        if event.payload and isinstance(event.payload, dict):
            source = event.payload.get("source")

        results.append(
            CheckInListItem(
                id=event.id,
                attendee_product_id=event.attendee_product_id,
                occurred_at=event.occurred_at,
                source=source,
                attendee_name=attendee.name if attendee else None,
                attendee_email=attendee.email if attendee else None,
                product_name=product.name if product else None,
                actor_user_id=event.actor_user_id,
                actor_user_name=actor.full_name if actor else None,
                actor_user_email=actor.email if actor else None,
                payload=event.payload,
            )
        )

    return ListModel[CheckInListItem](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )
