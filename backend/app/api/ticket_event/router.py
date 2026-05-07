"""Router for ticket_events — backoffice scan-history endpoint.

Provides GET /ticket-events with optional filtering by attendee_product_id,
popup_id, and event_type. Eager-loads attendee + product data per row to
avoid N+1 queries. Tenant-scoped via TenantSession / RLS.
"""

import uuid

from fastapi import APIRouter
from sqlalchemy.orm import selectinload
from sqlmodel import func, select
from sqlmodel import select as sa_select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.product.models import Products
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.ticket_event.models import TicketEvent
from app.api.ticket_event.schemas import TicketEventListItem
from app.core.dependencies.users import CurrentCheckInOperator, TenantSession

router = APIRouter(prefix="/ticket-events", tags=["ticket_event"])


@router.get("", response_model=ListModel[TicketEventListItem])
async def list_ticket_events(
    db: TenantSession,
    current_user: CurrentCheckInOperator,
    attendee_product_id: uuid.UUID | None = None,
    popup_id: uuid.UUID | None = None,
    event_type: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 50,
) -> ListModel[TicketEventListItem]:
    """List ticket events with attendee + product names (BO only).

    Filters:
    - attendee_product_id: exact match on the ticket UUID
    - popup_id: joined through attendee_product → attendee → popup_id
    - event_type: exact match on event type string (e.g. 'check_in')

    Ordered by occurred_at DESC. Tenant isolation is enforced both via the
    TenantSession (separate DB connection per tenant) and by an explicit
    tenant_id filter (defence-in-depth, covers tables without RLS policies).
    """
    # Tenant filter — explicit defence-in-depth on top of TenantSession/RLS.
    # current_user.tenant_id is None only for superadmins, who get their own
    # TenantSession for the X-Tenant-Id header's tenant anyway.
    tenant_id_filter = current_user.tenant_id

    # Build base statement with eager loads to avoid N+1
    statement = (
        select(TicketEvent)
        .options(
            selectinload(TicketEvent.attendee_product)  # type: ignore[arg-type]
            .selectinload(AttendeeProducts.attendee),  # type: ignore[arg-type]
            selectinload(TicketEvent.attendee_product)  # type: ignore[arg-type]
            .selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
        )
    )

    if tenant_id_filter is not None:
        statement = statement.where(TicketEvent.tenant_id == tenant_id_filter)

    if attendee_product_id is not None:
        statement = statement.where(
            TicketEvent.attendee_product_id == attendee_product_id
        )

    if popup_id is not None:
        # Join through attendee_product → attendee to filter by popup_id
        statement = (
            statement.join(
                AttendeeProducts,
                TicketEvent.attendee_product_id == AttendeeProducts.id,
            )
            .join(
                Attendees,
                AttendeeProducts.attendee_id == Attendees.id,
            )
            .where(Attendees.popup_id == popup_id)
        )

    if event_type is not None:
        statement = statement.where(TicketEvent.event_type == event_type)

    # Count total rows for pagination
    count_statement = sa_select(func.count(TicketEvent.id))
    if tenant_id_filter is not None:
        count_statement = count_statement.where(
            TicketEvent.tenant_id == tenant_id_filter
        )
    if attendee_product_id is not None:
        count_statement = count_statement.where(
            TicketEvent.attendee_product_id == attendee_product_id
        )
    if popup_id is not None:
        count_statement = (
            count_statement.join(
                AttendeeProducts,
                TicketEvent.attendee_product_id == AttendeeProducts.id,
            )
            .join(
                Attendees,
                AttendeeProducts.attendee_id == Attendees.id,
            )
            .where(Attendees.popup_id == popup_id)
        )
    if event_type is not None:
        count_statement = count_statement.where(TicketEvent.event_type == event_type)

    total = db.exec(count_statement).one()

    # Apply ordering and pagination to main statement
    statement = (
        statement.order_by(TicketEvent.occurred_at.desc())  # type: ignore[union-attr]
        .offset(skip)
        .limit(limit)
    )

    events = list(db.exec(statement).all())

    results = []
    for event in events:
        ap: AttendeeProducts | None = event.attendee_product  # type: ignore[attr-defined]
        attendee: Attendees | None = ap.attendee if ap else None  # type: ignore[union-attr]
        product: Products | None = ap.product if ap else None  # type: ignore[union-attr]

        source: str | None = None
        if event.payload and isinstance(event.payload, dict):
            source = event.payload.get("source")

        results.append(
            TicketEventListItem(
                id=event.id,
                attendee_product_id=event.attendee_product_id,
                event_type=event.event_type,
                occurred_at=event.occurred_at,
                source=source,
                attendee_name=attendee.name if attendee else None,
                attendee_email=attendee.email if attendee else None,
                product_name=product.name if product else None,
                actor_user_id=event.actor_user_id,
                payload=event.payload,
            )
        )

    return ListModel[TicketEventListItem](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )
