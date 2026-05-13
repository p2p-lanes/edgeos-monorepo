"""Router for the backoffice scan-history endpoint.

Provides GET /check-ins with optional filtering by attendee_product_id and
popup_id. One row per scan event with full history.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import selectinload
from sqlmodel import Session, func, select
from sqlmodel import select as sa_select

from app.api.application.models import Applications
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.check_in.crud import record_check_in
from app.api.check_in.models import CheckIn
from app.api.check_in.schemas import (
    CheckInListItem,
    CheckInPayload,
    SelfCheckInOptions,
    SelfCheckInPopup,
    SelfCheckInRequest,
    SelfCheckInResult,
    SelfCheckInTicket,
)
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.user.models import Users
from app.core.db import engine
from app.core.dependencies.users import (
    CurrentCheckInOperator,
    CurrentHuman,
    HumanTenantSession,
    TenantSession,
)

router = APIRouter(prefix="/check-ins", tags=["check_in"])


def _get_self_check_in_popup(
    db: Session, popup_slug: str, tenant_id: uuid.UUID
) -> Popups:
    popup = db.exec(
        select(Popups).where(Popups.slug == popup_slug, Popups.tenant_id == tenant_id)
    ).first()
    if popup is None or not popup.self_check_in_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )
    return popup


def _human_ticket_owner_filter(human_id: uuid.UUID, popup_id: uuid.UUID):
    return (
        (Applications.human_id == human_id) & (Applications.popup_id == popup_id)
    ) | (
        (Attendees.human_id == human_id)
        & (Attendees.popup_id == popup_id)
        & Attendees.application_id.is_(None)  # type: ignore[union-attr]
    )


def _first_check_ins_by_ticket(
    db: Session,
    ticket_ids: list[uuid.UUID],
) -> dict[uuid.UUID, datetime]:
    if not ticket_ids:
        return {}
    rows = db.exec(
        select(
            CheckIn.attendee_product_id,
            func.min(CheckIn.occurred_at).label("first_check_in_at"),
        )
        .where(CheckIn.attendee_product_id.in_(ticket_ids))  # type: ignore[union-attr]
        .group_by(CheckIn.attendee_product_id)
    ).all()
    return {row.attendee_product_id: row.first_check_in_at for row in rows}


def _build_self_check_in_ticket(
    ticket: AttendeeProducts,
    first_check_in_at: datetime | None,
) -> SelfCheckInTicket:
    attendee = ticket.attendee
    product = ticket.product
    return SelfCheckInTicket(
        attendee_product_id=ticket.id,
        attendee_name=attendee.name,
        attendee_category=attendee.category,
        product_name=product.name,
        product_category=product.category,
        duration_type=product.duration_type,
        checked_in=first_check_in_at is not None,
        first_check_in_at=first_check_in_at,
    )


@router.get("/my/{popup_slug}/options", response_model=SelfCheckInOptions)
async def get_my_check_in_options(
    popup_slug: str,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> SelfCheckInOptions:
    popup = _get_self_check_in_popup(db, popup_slug, current_human.tenant_id)
    statement = (
        select(AttendeeProducts)
        .join(Attendees, AttendeeProducts.attendee_id == Attendees.id)  # type: ignore[arg-type]
        .join(Products, AttendeeProducts.product_id == Products.id)  # type: ignore[arg-type]
        .outerjoin(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
        .where(
            AttendeeProducts.tenant_id == current_human.tenant_id,
            Attendees.popup_id == popup.id,
            Products.requires_check_in.is_(True),  # type: ignore[union-attr]
            _human_ticket_owner_filter(current_human.id, popup.id),
        )
        .options(
            selectinload(AttendeeProducts.attendee),  # type: ignore[arg-type]
            selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
        )
    )
    tickets = list(db.exec(statement).all())
    first_check_ins = _first_check_ins_by_ticket(db, [ticket.id for ticket in tickets])
    return SelfCheckInOptions(
        popup=SelfCheckInPopup(id=popup.id, name=popup.name, slug=popup.slug),
        tickets=[
            _build_self_check_in_ticket(ticket, first_check_ins.get(ticket.id))
            for ticket in tickets
        ],
    )


@router.post("/my/{popup_slug}", response_model=SelfCheckInResult)
async def confirm_my_check_in(
    popup_slug: str,
    request: SelfCheckInRequest,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> SelfCheckInResult:
    popup = _get_self_check_in_popup(db, popup_slug, current_human.tenant_id)
    # Lock ownership-matching ticket in a single FOR UPDATE statement so we
    # never lock rows the human doesn't own and avoid a TOCTOU between the
    # lock and the ownership check.
    ticket = db.exec(
        select(AttendeeProducts)
        .join(Attendees, AttendeeProducts.attendee_id == Attendees.id)  # type: ignore[arg-type]
        .outerjoin(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
        .where(
            AttendeeProducts.id == request.attendee_product_id,
            AttendeeProducts.tenant_id == current_human.tenant_id,
            Attendees.popup_id == popup.id,
            _human_ticket_owner_filter(current_human.id, popup.id),
        )
        .with_for_update(of=AttendeeProducts)
        .options(
            selectinload(AttendeeProducts.attendee),  # type: ignore[arg-type]
            selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
        )
    ).first()
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found"
        )

    attendee = ticket.attendee
    product = ticket.product

    if not product.requires_check_in:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Product does not require check-in",
        )

    existing = db.exec(
        select(CheckIn.id).where(CheckIn.attendee_product_id == ticket.id).limit(1)
    ).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ticket is already checked in",
        )

    event = record_check_in(
        db,
        attendee_product_id=ticket.id,
        popup_id=popup.id,
        payload=CheckInPayload(source="self_service", human_id=current_human.id),
        actor_user_id=None,
    )

    return SelfCheckInResult(
        attendee_product_id=ticket.id,
        attendee_name=attendee.name,
        attendee_category=attendee.category,
        product_name=product.name,
        product_category=product.category,
        duration_type=product.duration_type,
        checked_in=True,
        checked_in_at=event.occurred_at,
    )


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
