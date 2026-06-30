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
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, select

from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.models import AuditLog
from app.api.human.activity_schemas import (
    HumanActivityItem,
    HumanActivityKind,
    HumanActivityProduct,
)

if TYPE_CHECKING:
    from app.api.human.models import HumanComment

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


def rating_log_to_item(log: AuditLog) -> HumanActivityItem:
    """Map a `human.rating_changed` audit row to a timeline item.

    The new and previous ratings (HumanRating string values) live in the audit
    row's `details`; the effective time is the real write time.
    """
    details = log.details or {}
    return HumanActivityItem(
        id=f"rating:{log.id}",
        kind=HumanActivityKind.RATING_CHANGED,
        occurred_at=_as_utc(log.created_at),
        rating=details.get("rating"),
        previous_rating=details.get("previous"),
        actor_id=log.actor_id,
        actor_name=log.actor_name,
        actor_email=log.actor_email,
    )


def credit_log_to_item(log: AuditLog) -> HumanActivityItem:
    """Map a credit.* audit row to a timeline item.

    Credit actions (credit.granted, credit.applied, credit.restored) are
    recorded with entity_type=HUMAN so they land on the human timeline via the
    standard audit_logs query. The details dict carries amount, source,
    balance_after, and optionally payment_id and note.
    """
    _KIND_MAP = {
        AuditAction.CREDIT_GRANTED: HumanActivityKind.CREDIT_GRANTED,
        AuditAction.CREDIT_APPLIED: HumanActivityKind.CREDIT_APPLIED,
        AuditAction.CREDIT_RESTORED: HumanActivityKind.CREDIT_RESTORED,
    }
    details = log.details or {}
    kind = _KIND_MAP.get(log.action, HumanActivityKind.CREDIT_GRANTED)
    amount_raw = details.get("amount")
    amount = Decimal(str(amount_raw)) if amount_raw is not None else None
    balance_raw = details.get("balance_after")
    balance_after = Decimal(str(balance_raw)) if balance_raw is not None else None
    return HumanActivityItem(
        id=f"credit:{log.id}",
        kind=kind,
        occurred_at=_as_utc(log.created_at),
        popup_id=log.popup_id,
        amount=amount,
        source=details.get("source"),
        balance_after=balance_after,
        note=details.get("note"),
        actor_id=log.actor_id,
        actor_name=log.actor_name,
        actor_email=log.actor_email,
    )


def comment_to_item(comment: "HumanComment") -> HumanActivityItem:
    """Map a (non-deleted) human comment to a timeline item.

    The body is carried in `note` (the generic text field); the author becomes
    the actor and the comment's own `created_at` is the effective time.
    """
    return HumanActivityItem(
        id=f"comment:{comment.id}",
        kind=HumanActivityKind.COMMENT_ADDED,
        occurred_at=_as_utc(comment.created_at),
        note=comment.body,
        actor_id=comment.author_user_id,
        actor_name=comment.author_name,
        actor_email=comment.author_email,
    )


def build_human_activity(
    session: Session,
    control_session: Session,
    human_id: uuid.UUID,
    *,
    skip: int,
    limit: int,
) -> tuple[list[HumanActivityItem], int]:
    """Build a human's full activity timeline, newest-first, then page it.

    Returns ``(items[skip : skip + limit], total)`` where ``total`` is the
    exact count across all sources.

    Most sources are read through the RLS-scoped ``session``. Comments are the
    exception: ``human_comments`` is a global table with no tenant RLS or grants
    (it is reached only through the privileged engine), so it is read through
    ``control_session`` instead. The caller must already have verified the human
    belongs to the tenant before calling this.
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

    # 4. Audit-log–backed items: manual notes + rating changes + credit movements.
    # All live in `audit_logs` (tenant-scoped, read through `session`) and are
    # told apart by their action.
    _CREDIT_ACTIONS = {
        AuditAction.CREDIT_GRANTED,
        AuditAction.CREDIT_APPLIED,
        AuditAction.CREDIT_RESTORED,
    }
    audit_logs = session.exec(
        select(AuditLog).where(
            AuditLog.entity_type == AuditEntityType.HUMAN,
            AuditLog.entity_id == human_id,
            col(AuditLog.action).in_(
                [
                    AuditAction.HUMAN_NOTE_ADDED,
                    AuditAction.HUMAN_RATING_CHANGED,
                    AuditAction.CREDIT_GRANTED,
                    AuditAction.CREDIT_APPLIED,
                    AuditAction.CREDIT_RESTORED,
                ]
            ),
        )
    ).all()
    for log in audit_logs:
        if log.action == AuditAction.HUMAN_RATING_CHANGED:
            items.append(rating_log_to_item(log))
        elif log.action in _CREDIT_ACTIONS:
            items.append(credit_log_to_item(log))
        else:
            items.append(note_log_to_item(log))

    # 5. Comments — the global `human_comments` table has no tenant RLS/grants,
    # so it is read through the privileged `control_session`. Soft-deleted
    # comments are already filtered out by `list_comments`.
    from app.api.human.crud import humans_crud

    items.extend(
        comment_to_item(comment)
        for comment in humans_crud.list_comments(control_session, human_id)
    )

    # 6. Popup labels — one query for all referenced popups (avoid N+1).
    popup_ids = {item.popup_id for item in items if item.popup_id is not None}
    if popup_ids:
        rows = session.exec(
            select(Popups.id, Popups.name).where(Popups.id.in_(popup_ids))  # type: ignore[attr-defined]
        ).all()
        labels = dict(rows)
        for item in items:
            if item.popup_id is not None:
                item.popup_label = labels.get(item.popup_id)

    # 7. Merge: newest-first by effective timestamp, then page.
    items.sort(key=lambda i: i.occurred_at, reverse=True)
    total = len(items)
    return items[skip : skip + limit], total
