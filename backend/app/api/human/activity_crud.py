"""Aggregate-on-read builder for a human's activity timeline.

Per-human cardinality is tiny (one person's applications / payments /
attendees / notes — at most tens of rows), so every source table is queried,
the items are merged + sorted in Python, and the requested page is sliced out.
This makes the feature work day-one for existing humans with no backfill.

Manual notes are NOT a source table of their own — they live in `audit_logs`
under the `human.note_added` action, with the admin-chosen time in
`details.occurred_at`.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.models import AuditLog
from app.api.human.activity_schemas import (
    HumanActivityItem,
    HumanActivityKind,
    HumanActivityProduct,
)

# Snapshot event value emitted when an application is accepted.
_ACCEPTED_EVENT = "accepted"


def _as_utc(value: datetime) -> datetime:
    """Normalize a datetime to aware UTC so items sort consistently.

    DB timestamptz columns come back aware, but defensively coerce naive values
    (treated as UTC) so the merge never mixes naive and aware datetimes.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _note_occurred_at(log: AuditLog) -> datetime:
    """Effective timestamp for a note: the admin-chosen time, else write time."""
    raw = (log.details or {}).get("occurred_at")
    if isinstance(raw, str):
        try:
            return _as_utc(datetime.fromisoformat(raw))
        except ValueError:
            pass
    return _as_utc(log.created_at)


def note_log_to_item(log: AuditLog) -> HumanActivityItem:
    """Map a `human.note_added` audit row to a timeline item.

    Shared by the write path (so POST returns the same shape) and the read
    path (so notes merge with the aggregated items).
    """
    details = log.details or {}
    return HumanActivityItem(
        id=f"note:{log.id}",
        kind=HumanActivityKind.NOTE_ADDED,
        occurred_at=_note_occurred_at(log),
        note=details.get("note"),
        actor_id=log.actor_id,
        actor_name=log.actor_name,
        actor_email=log.actor_email,
    )


def build_human_activity(
    session: Session,
    human_id: uuid.UUID,
    *,
    skip: int,
    limit: int,
) -> tuple[list[HumanActivityItem], int]:
    """Build a human's full activity timeline, newest-first, then page it.

    Returns ``(items[skip : skip + limit], total)`` where ``total`` is the
    exact count across all sources.
    """
    # Imported lazily to avoid a circular import: the human router (which loads
    # this module) is imported while application.models is still initializing.
    from app.api.application.models import Applications
    from app.api.attendee.models import Attendees
    from app.api.payment.models import Payments
    from app.api.payment.schemas import PaymentStatus
    from app.api.popup.models import Popups

    items: list[HumanActivityItem] = []

    # 1. Applications — submitted + accepted (from snapshots).
    applications = session.exec(
        select(Applications)
        .where(Applications.human_id == human_id)
        .options(selectinload(Applications.snapshots))  # type: ignore[arg-type]
    ).all()

    for app in applications:
        submitted_at = app.submitted_at or app.created_at
        if submitted_at is not None:
            items.append(
                HumanActivityItem(
                    id=f"application-submitted:{app.id}",
                    kind=HumanActivityKind.APPLICATION_SUBMITTED,
                    occurred_at=_as_utc(submitted_at),
                    popup_id=app.popup_id,
                )
            )

        # Emit at most one "accepted" item, from the earliest accepted snapshot.
        accepted_snapshots = sorted(
            (s for s in app.snapshots if s.event == _ACCEPTED_EVENT),
            key=lambda s: s.created_at,
        )
        if accepted_snapshots:
            snap = accepted_snapshots[0]
            items.append(
                HumanActivityItem(
                    id=f"application-accepted:{app.id}",
                    kind=HumanActivityKind.APPLICATION_ACCEPTED,
                    occurred_at=_as_utc(snap.created_at),
                    popup_id=app.popup_id,
                )
            )

    # 2. Payments — completed (approved) purchases, with the product snapshot.
    payments = session.exec(
        select(Payments)
        .join(Applications, Payments.application_id == Applications.id)  # type: ignore[arg-type]
        .where(
            Applications.human_id == human_id,
            Payments.status == PaymentStatus.APPROVED.value,
        )
        .options(selectinload(Payments.products_snapshot))  # type: ignore[arg-type]
    ).all()

    for payment in payments:
        products = [
            HumanActivityProduct(
                product_name=pp.product_name,
                product_category=pp.product_category,
                quantity=pp.quantity,
            )
            for pp in payment.products_snapshot
        ]
        items.append(
            HumanActivityItem(
                id=f"payment:{payment.id}",
                kind=HumanActivityKind.PAYMENT_COMPLETED,
                occurred_at=_as_utc(payment.created_at),
                popup_id=payment.popup_id,
                amount=payment.amount,
                currency=payment.currency,
                status=payment.status,
                products=products,
            )
        )

    # 3. Attendees — ticket-holder records linked to this human.
    attendees = session.exec(
        select(Attendees).where(Attendees.human_id == human_id)
    ).all()

    for attendee in attendees:
        items.append(
            HumanActivityItem(
                id=f"attendee:{attendee.id}",
                kind=HumanActivityKind.TICKET_ADDED,
                occurred_at=_as_utc(attendee.created_at),
                popup_id=attendee.popup_id,
            )
        )

    # 4. Manual notes — stored in audit_logs under human.note_added.
    note_logs = session.exec(
        select(AuditLog).where(
            AuditLog.entity_type == AuditEntityType.HUMAN,
            AuditLog.entity_id == human_id,
            AuditLog.action == AuditAction.HUMAN_NOTE_ADDED,
        )
    ).all()
    items.extend(note_log_to_item(log) for log in note_logs)

    # 5. Popup labels — one query for all referenced popups (avoid N+1).
    popup_ids = {item.popup_id for item in items if item.popup_id is not None}
    if popup_ids:
        rows = session.exec(
            select(Popups.id, Popups.name).where(Popups.id.in_(popup_ids))  # type: ignore[attr-defined]
        ).all()
        labels = dict(rows)
        for item in items:
            if item.popup_id is not None:
                item.popup_label = labels.get(item.popup_id)

    # 6. Merge: newest-first by effective timestamp, then page.
    items.sort(key=lambda i: i.occurred_at, reverse=True)
    total = len(items)
    return items[skip : skip + limit], total
