"""Aggregate-on-read builder for a human's applications in other popups.

Per-human cardinality is tiny (one person applies to at most a handful of
popups), so the summary is assembled from four fixed queries and merged in
Python rather than denormalized anywhere. This makes the feature work day-one
for existing data with no backfill.

Tenant isolation is implicit: `applications` is RLS-scoped, so a session bound
to one tenant can never read another tenant's rows.
"""

import uuid
from collections import defaultdict
from decimal import Decimal

from sqlmodel import Session, col, func, select

from app.api.application.schemas import (
    PreviousApplicationSpend,
    PreviousApplicationSummary,
)


def _ticket_counts(
    session: Session, application_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Purchased tickets per application.

    `attendee_products` holds one row per ticket (not a row per product with a
    quantity — see `Attendees.get_product_quantity`), so counting rows counts
    tickets. Companions are included: their tickets were bought on the same
    application.
    """
    from app.api.attendee.models import AttendeeProducts, Attendees

    rows = session.exec(
        select(Attendees.application_id, func.count(col(AttendeeProducts.id)))
        .join(AttendeeProducts, col(AttendeeProducts.attendee_id) == Attendees.id)
        .where(col(Attendees.application_id).in_(application_ids))
        .group_by(col(Attendees.application_id))
    ).all()
    return {application_id: count for application_id, count in rows if application_id}


def _spend_by_application(
    session: Session, application_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[PreviousApplicationSpend]]:
    """Approved spend per application, grouped by currency.

    Only `approved` payments count: pending / expired / rejected ones represent
    intent, not money taken. Same rule the human activity timeline uses.
    """
    from app.api.payment.models import Payments
    from app.api.payment.schemas import PaymentStatus

    rows = session.exec(
        select(
            Payments.application_id,
            Payments.currency,
            func.sum(col(Payments.amount)),
        )
        .where(
            col(Payments.application_id).in_(application_ids),
            Payments.status == PaymentStatus.APPROVED.value,
        )
        .group_by(col(Payments.application_id), col(Payments.currency))
    ).all()

    by_application: dict[uuid.UUID, list[PreviousApplicationSpend]] = defaultdict(list)
    for application_id, currency, total in rows:
        if application_id is None or not total:
            continue
        by_application[application_id].append(
            PreviousApplicationSpend(
                currency=currency or "USD", amount=Decimal(str(total))
            )
        )
    # Deterministic render order when an application spans currencies.
    for spend in by_application.values():
        spend.sort(key=lambda s: s.currency)
    return by_application


def _newest_first(summary: PreviousApplicationSummary) -> tuple[bool, float]:
    """Sort key: submission date, else creation date, descending.

    Compares POSIX timestamps rather than datetimes so a naive value can never
    raise against an aware one. Rows with neither timestamp sort last.
    """
    effective = summary.submitted_at or summary.created_at
    return (effective is None, -effective.timestamp() if effective else 0.0)


def build_previous_applications(
    session: Session,
    *,
    human_id: uuid.UUID,
    exclude_popup_id: uuid.UUID,
) -> list[PreviousApplicationSummary]:
    """Summarize this human's applications to popups other than the current one.

    Returns every application regardless of status — a draft that was never
    submitted, or a rejection, is signal for whoever is reviewing now. Ordered
    newest-first by submission date, falling back to creation date.
    """
    # Imported lazily to avoid a circular import: this module is loaded from the
    # application router while application.models is still initializing.
    from app.api.application.models import Applications
    from app.api.popup.models import Popups

    applications = session.exec(
        select(Applications).where(
            Applications.human_id == human_id,
            Applications.popup_id != exclude_popup_id,
        )
    ).all()
    if not applications:
        return []

    application_ids = [application.id for application in applications]
    popup_ids = {application.popup_id for application in applications}

    popups = {
        popup_id: (name, start_date)
        for popup_id, name, start_date in session.exec(
            select(Popups.id, Popups.name, Popups.start_date).where(
                col(Popups.id).in_(popup_ids)
            )
        ).all()
    }
    tickets = _ticket_counts(session, application_ids)
    spend = _spend_by_application(session, application_ids)

    summaries = [
        PreviousApplicationSummary(
            id=application.id,
            popup_id=application.popup_id,
            popup_name=popups.get(application.popup_id, (None, None))[0],
            popup_start_date=popups.get(application.popup_id, (None, None))[1],
            status=application.status,
            tickets_count=tickets.get(application.id, 0),
            spend=spend.get(application.id, []),
            submitted_at=application.submitted_at,
            created_at=getattr(application, "created_at", None),
        )
        for application in applications
    ]

    summaries.sort(key=_newest_first)
    return summaries
