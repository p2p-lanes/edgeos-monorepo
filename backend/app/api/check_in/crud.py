"""CRUD functions for the check_ins table."""

import uuid
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlmodel import Session, func, select

from app.api.check_in.models import CheckIn
from app.api.check_in.schemas import CheckInPayload


def record_check_in(
    session: Session,
    attendee_product_id: uuid.UUID,
    popup_id: uuid.UUID,
    payload: CheckInPayload,
    actor_user_id: uuid.UUID | None,
    commit: bool = True,
) -> CheckIn:
    """Insert a check_ins row and return the persisted instance.

    Args:
        session: active SQLModel session (caller owns the transaction).
        attendee_product_id: UUID PK of the AttendeeProducts (ticket) row.
        popup_id: popup the scan happened in (required — caller has already
            validated it matches `attendee.popup_id`).
        payload: CheckInPayload with source and optional notes.
        actor_user_id: user who performed the scan; None for system events.

    Returns:
        Persisted CheckIn row.
    """
    # Need tenant_id — look it up from the ticket row
    from app.api.attendee.models import AttendeeProducts

    ticket = session.get(AttendeeProducts, attendee_product_id)
    if ticket is None:
        raise ValueError(f"Ticket {attendee_product_id} not found")

    event = CheckIn(
        id=uuid.uuid4(),
        tenant_id=ticket.tenant_id,
        popup_id=popup_id,
        attendee_product_id=attendee_product_id,
        actor_user_id=actor_user_id,
        payload=payload.model_dump(mode="json", exclude_none=True),
    )
    session.add(event)
    if commit:
        session.commit()
        session.refresh(event)
    else:
        session.flush()
    return event


def list_check_ins_for_ticket(
    session: Session,
    attendee_product_id: uuid.UUID,
) -> list[CheckIn]:
    """Return all check_ins for a given ticket, ordered by occurred_at DESC.

    Args:
        session: active SQLModel session.
        attendee_product_id: UUID PK of the AttendeeProducts (ticket) row.

    Returns:
        List of CheckIn rows ordered DESC by occurred_at (latest first).
    """
    statement = (
        select(CheckIn)
        .where(CheckIn.attendee_product_id == attendee_product_id)
        .order_by(CheckIn.occurred_at.desc())  # type: ignore[union-attr]
    )
    return list(session.exec(statement).all())


def get_check_in_summary(
    session: Session,
    attendee_product_id: uuid.UUID,
) -> dict[str, Any]:
    """Return check-in summary for a ticket via a single aggregation query.

    Counts check-ins and returns min/max occurred_at so caller can populate
    total_scans, first_scan_at, last_scan_at on TicketPublic.

    Returns:
        dict with keys: total_scans (int), first_scan_at (datetime|None),
        last_scan_at (datetime|None).
    """
    row = session.exec(
        select(
            func.count(CheckIn.id).label("total_scans"),
            func.min(CheckIn.occurred_at).label("first_scan_at"),
            func.max(CheckIn.occurred_at).label("last_scan_at"),
        ).where(CheckIn.attendee_product_id == attendee_product_id)
    ).one()

    return {
        "total_scans": row.total_scans or 0,
        "first_scan_at": row.first_scan_at,
        "last_scan_at": row.last_scan_at,
    }


def get_last_scan_by_tickets(
    session: Session,
    ticket_ids: Iterable[uuid.UUID],
) -> dict[uuid.UUID, datetime]:
    """Return {attendee_product_id: max(occurred_at)} for the given ticket IDs.

    Only tickets that have at least one check-in row appear in the result —
    callers should treat missing keys as "never scanned". Implemented as a
    single aggregation to avoid N+1 when an attendee has multiple tickets.
    """
    ticket_id_list = list(ticket_ids)
    if not ticket_id_list:
        return {}

    rows = session.exec(
        select(
            CheckIn.attendee_product_id,
            func.max(CheckIn.occurred_at).label("last_scan_at"),
        )
        .where(CheckIn.attendee_product_id.in_(ticket_id_list))  # type: ignore[union-attr]
        .group_by(CheckIn.attendee_product_id)
    ).all()

    return {row.attendee_product_id: row.last_scan_at for row in rows}
