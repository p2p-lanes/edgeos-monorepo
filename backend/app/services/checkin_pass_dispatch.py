"""Scheduled dispatch of check-in pass emails.

Invoked by an external scheduler via ``POST /internal/cron/checkin-passes``
(see ``app/api/internal/router.py``). Runs as a cross-tenant system job on the
superuser session — the same pattern as the SimpleFi webhook — so it sees rows
across all tenants without per-tenant engine juggling.

For every popup with ``checkin_pass_lead_days`` set whose start is within the
send window, this emails the buyer one message containing the check-in QR code
for each scannable ticket they purchased. The email content comes from the
popup's custom ``CHECK_IN_PASS`` template, or the file-based default when none
exists (handled by ``send_check_in_pass`` → ``render_with_fallback``).

A per-ticket ``checkin_pass_sent_at`` stamp (set only after a successful send)
makes repeated runs idempotent; a Postgres advisory lock makes overlapping runs
safe (only one dispatch executes at a time).
"""

import uuid
from datetime import UTC, datetime, timedelta

from loguru import logger
from sqlalchemy import text
from sqlmodel import Session, select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.utils import get_portal_url
from app.services.checkin_qr import generate_checkin_qr_url
from app.services.email import CheckInPassContext, CheckInQrItem, get_email_service

# Arbitrary fixed key identifying the "check-in pass dispatch" advisory lock.
# Every run contends on this same key so only one dispatch proceeds at a time.
DISPATCH_ADVISORY_LOCK_KEY = 4827133295


def _as_utc(dt: datetime | None) -> datetime | None:
    """Popup start/end dates are stored timezone-naive; treat them as UTC so
    they compare cleanly against an aware ``now``."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def _resolve_buyer(ticket: AttendeeProducts) -> Humans | None:
    """The human who should receive the pass: the application owner (buyer),
    falling back to the attendee's own human for direct sales."""
    attendee = ticket.attendee
    if attendee is None:
        return None
    if attendee.application is not None and attendee.application.human is not None:
        return attendee.application.human
    return attendee.human


def _due_popups(db: Session, now: datetime) -> list[Popups]:
    """Popups with check-in passes enabled and within the send window.

    Enablement + schedule live on the popup: ``checkin_pass_lead_days`` set to
    a positive value enables it. Window: ``now >= start_date -
    checkin_pass_lead_days`` and (no end_date or ``now < end_date``).
    """
    popups = db.exec(
        select(Popups).where(
            Popups.checkin_pass_lead_days.is_not(None),  # type: ignore[union-attr]
            Popups.start_date.is_not(None),  # type: ignore[union-attr]
        )
    ).all()

    due: list[Popups] = []
    for popup in popups:
        lead = popup.checkin_pass_lead_days
        if not lead or lead <= 0:
            continue
        start = _as_utc(popup.start_date)
        end = _as_utc(popup.end_date)
        send_from = start - timedelta(days=lead)
        if now < send_from:
            continue
        if end is not None and now >= end:
            continue
        due.append(popup)
    return due


def _unsent_scannable_tickets(db: Session, popup: Popups) -> list[AttendeeProducts]:
    """Tickets in *popup* that require check-in and have not been emailed yet."""
    return list(
        db.exec(
            select(AttendeeProducts)
            .join(Attendees, AttendeeProducts.attendee_id == Attendees.id)
            .join(Products, AttendeeProducts.product_id == Products.id)
            .where(
                Attendees.popup_id == popup.id,
                Products.requires_check_in == True,  # noqa: E712
                AttendeeProducts.checkin_pass_sent_at.is_(None),  # type: ignore[union-attr]
            )
        ).all()
    )


async def _send_popup_passes(db: Session, popup: Popups, now: datetime) -> dict:
    """Send (and mark) all due check-in passes for a single popup."""
    tickets = _unsent_scannable_tickets(db, popup)
    if not tickets:
        return {"emails_sent": 0, "tickets_marked": 0, "failures": 0}

    # Group tickets by buyer (keyed by id — ORM objects aren't hashable);
    # drop tickets whose buyer has no email.
    by_buyer: dict[uuid.UUID, tuple[Humans, list[AttendeeProducts]]] = {}
    for ticket in tickets:
        buyer = _resolve_buyer(ticket)
        if buyer is None or not buyer.email:
            logger.warning(
                "Skipping check-in pass for ticket {}: no buyer email", ticket.id
            )
            continue
        by_buyer.setdefault(buyer.id, (buyer, []))[1].append(ticket)

    email_service = get_email_service()
    portal_url = get_portal_url(popup.tenant)
    sender_email = popup.tenant.sender_email
    sender_name = popup.tenant.sender_name

    emails_sent = tickets_marked = failures = 0
    for buyer, buyer_tickets in by_buyer.values():
        try:
            qrs = [
                CheckInQrItem(
                    attendee_name=t.attendee.name,
                    product_name=t.product.name,
                    check_in_code=t.check_in_code,
                    qr_url=generate_checkin_qr_url(t.check_in_code),
                )
                for t in buyer_tickets
            ]
            context = CheckInPassContext(
                first_name=buyer.first_name or "",
                popup_name=popup.name,
                checkin_qrs=qrs,
                checkin_qr_url=qrs[0].qr_url if qrs else None,
                portal_url=portal_url,
            )
            ok = await email_service.send_check_in_pass(
                to=buyer.email,
                subject=f"Your check-in pass for {popup.name}",
                context=context,
                from_address=sender_email,
                from_name=sender_name,
                popup_id=popup.id,
                db_session=db,
            )
            if ok:
                # Mark after a successful send (at-least-once): a crash before
                # this leaves tickets unsent -> retried next run.
                for t in buyer_tickets:
                    t.checkin_pass_sent_at = now
                    db.add(t)
                db.commit()
                emails_sent += 1
                tickets_marked += len(buyer_tickets)
            else:
                db.rollback()
                failures += 1
                logger.error(
                    "Check-in pass send failed for buyer {} (popup {})",
                    buyer.email,
                    popup.id,
                )
        except Exception:  # noqa: BLE001 - isolate per-buyer failures
            db.rollback()
            failures += 1
            logger.exception(
                "Error sending check-in pass for buyer {} (popup {})",
                getattr(buyer, "email", "?"),
                popup.id,
            )

    return {
        "emails_sent": emails_sent,
        "tickets_marked": tickets_marked,
        "failures": failures,
    }


async def _run_dispatch(db: Session, now: datetime) -> dict:
    due = _due_popups(db, now)
    summary = {
        "status": "ok",
        "popups_processed": 0,
        "emails_sent": 0,
        "tickets_marked": 0,
        "failures": 0,
    }
    for popup in due:
        result = await _send_popup_passes(db, popup, now)
        summary["popups_processed"] += 1
        summary["emails_sent"] += result["emails_sent"]
        summary["tickets_marked"] += result["tickets_marked"]
        summary["failures"] += result["failures"]
    return summary


async def dispatch_checkin_passes(db: Session) -> dict:
    """Entry point for the cron endpoint.

    Holds a Postgres advisory lock on a dedicated connection (independent of the
    work session's per-buyer commits) so overlapping runs no-op instead of
    double-sending. Returns a summary dict.
    """
    now = datetime.now(UTC)
    lock_conn = db.get_bind().connect()
    try:
        got = lock_conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"),
            {"k": DISPATCH_ADVISORY_LOCK_KEY},
        ).scalar()
        if not got:
            logger.info("Check-in pass dispatch already running; skipping")
            return {"status": "skipped", "reason": "another dispatch is running"}
        try:
            return await _run_dispatch(db, now)
        finally:
            lock_conn.execute(
                text("SELECT pg_advisory_unlock(:k)"),
                {"k": DISPATCH_ADVISORY_LOCK_KEY},
            )
            lock_conn.commit()
    finally:
        lock_conn.close()
