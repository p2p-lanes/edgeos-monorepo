"""CRUD functions for ticket_events event log.

Addendum #12: check-in event recording and summary queries.
Future: transfer, refund, edit events follow the same pattern.
"""

import uuid
from typing import Any

from sqlmodel import Session, func, select

from app.api.ticket_event.models import TicketEvent
from app.api.ticket_event.schemas import CheckInPayload


def record_check_in(
    session: Session,
    attendee_product_id: uuid.UUID,
    popup_id: uuid.UUID,
    payload: CheckInPayload,
    actor_user_id: uuid.UUID | None,
) -> TicketEvent:
    """Insert a check_in TicketEvent row and return the persisted instance.

    Args:
        session: active SQLModel session (caller owns the transaction).
        attendee_product_id: UUID PK of the AttendeeProducts (ticket) row.
        popup_id: popup the scan happened in (required — caller has already
            validated it matches `attendee.popup_id`).
        payload: CheckInPayload with source and optional notes.
        actor_user_id: user who performed the scan; None for system events.

    Returns:
        Persisted TicketEvent with event_type='check_in'.
    """
    # Need tenant_id — look it up from the ticket row
    from app.api.attendee.models import AttendeeProducts

    ticket = session.get(AttendeeProducts, attendee_product_id)
    if ticket is None:
        raise ValueError(f"Ticket {attendee_product_id} not found")

    event = TicketEvent(
        id=uuid.uuid4(),
        tenant_id=ticket.tenant_id,
        popup_id=popup_id,
        attendee_product_id=attendee_product_id,
        event_type="check_in",
        actor_user_id=actor_user_id,
        payload=payload.model_dump(),
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def list_events_for_ticket(
    session: Session,
    attendee_product_id: uuid.UUID,
    event_type: str | None = None,
) -> list[TicketEvent]:
    """Return all ticket_events for a given ticket, ordered by occurred_at DESC.

    Args:
        session: active SQLModel session.
        attendee_product_id: UUID PK of the AttendeeProducts (ticket) row.
        event_type: optional filter; if provided, only matching event types returned.

    Returns:
        List of TicketEvent rows ordered DESC by occurred_at (latest first).
    """
    statement = select(TicketEvent).where(
        TicketEvent.attendee_product_id == attendee_product_id
    )
    if event_type is not None:
        statement = statement.where(TicketEvent.event_type == event_type)
    statement = statement.order_by(TicketEvent.occurred_at.desc())  # type: ignore[union-attr]
    return list(session.exec(statement).all())


def get_check_in_summary(
    session: Session,
    attendee_product_id: uuid.UUID,
) -> dict[str, Any]:
    """Return check-in summary for a ticket via a single aggregation query.

    Counts check_in events and returns min/max occurred_at so caller can
    populate total_scans, first_scan_at, last_scan_at on TicketPublic.

    Returns:
        dict with keys: total_scans (int), first_scan_at (datetime|None),
        last_scan_at (datetime|None).
    """
    row = session.exec(
        select(
            func.count(TicketEvent.id).label("total_scans"),
            func.min(TicketEvent.occurred_at).label("first_scan_at"),
            func.max(TicketEvent.occurred_at).label("last_scan_at"),
        ).where(
            TicketEvent.attendee_product_id == attendee_product_id,
            TicketEvent.event_type == "check_in",
        )
    ).one()

    return {
        "total_scans": row.total_scans or 0,
        "first_scan_at": row.first_scan_at,
        "last_scan_at": row.last_scan_at,
    }
