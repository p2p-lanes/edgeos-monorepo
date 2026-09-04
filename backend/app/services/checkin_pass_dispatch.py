"""Scheduled dispatch of the check-in pass email.

Invoked by an external scheduler via ``POST /internal/cron/checkin-passes``
(see ``app/api/internal/router.py``). Runs as a cross-tenant system job on the
superuser session — the same pattern as the SimpleFi webhook — so it sees rows
across all tenants without per-tenant engine juggling.

For every popup with ``checkin_pass_lead_days`` set, this emails the buyer one
message containing the check-in QR code for each scannable ticket they
purchased. The send window opens ``lead_days`` before ``start_date`` and stays
open until ``end_date`` (or indefinitely when end_date is null), so the same
mechanism also covers tickets purchased after the event has started — the run
that follows the new purchase picks them up and ships their QRs.

A per-ticket ``checkin_pass_sent_at`` stamp (set only after a successful send)
makes repeated runs idempotent; a Postgres advisory lock makes overlapping runs
safe (only one dispatch executes at a time).
"""

import uuid
from datetime import UTC, datetime, timedelta

from loguru import logger
from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.email_template.schemas import EmailTemplateType
from app.api.human.models import Humans
from app.api.payment.models import Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.utils import get_portal_url
from app.services.checkin_qr import generate_checkin_qr_url
from app.services.email import CheckInPassContext, CheckInQrItem, get_email_service
from app.services.email.templates import render_default_subject

# Arbitrary fixed key identifying the "check-in pass dispatch" advisory lock.
# Every run contends on this same key so only one dispatch proceeds at a time.
DISPATCH_ADVISORY_LOCK_KEY = 4827133295


def _as_utc(dt: datetime | None) -> datetime | None:
    """Popup start/end dates are stored timezone-naive; treat them as UTC so
    they compare cleanly against an aware ``now``."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def _resolve_buyer(db: Session, ticket: AttendeeProducts) -> Humans | None:
    """Resolve immutable Payment buyer first, then allocated legacy ownership."""
    if ticket.payment_id is not None:
        payment = db.get(Payments, ticket.payment_id)
        if payment is not None and payment.buyer_human_id is not None:
            return db.get(Humans, payment.buyer_human_id)
    attendee = ticket.attendee
    if attendee is None:
        return None
    if attendee.application is not None and attendee.application.human is not None:
        return attendee.application.human
    return attendee.human


def _find_unsent_units(
    db: Session, flow: SalesFlows, popup: Popups
) -> list[AttendeeProducts]:
    """Return active scannable units scoped to the flow's notification window."""
    statement = (
        select(AttendeeProducts)
        .outerjoin(Attendees, AttendeeProducts.attendee_id == Attendees.id)  # type: ignore[arg-type]
        .join(Products, AttendeeProducts.product_id == Products.id)  # type: ignore[arg-type]
        .outerjoin(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
        .outerjoin(Payments, AttendeeProducts.payment_id == Payments.id)  # type: ignore[arg-type]
        .where(
            Products.popup_id == popup.id,
            AttendeeProducts.revoked_at.is_(None),
            Products.requires_check_in.is_(True),
            or_(
                AttendeeProducts.attendee_id.is_(None),
                func.lower(AttendeeProducts.product_category_snapshot) == "ticket",
            ),
            AttendeeProducts.checkin_pass_sent_at.is_(None),
        )
    )
    scope = or_(
        Applications.sales_flow_id == flow.id,
        Payments.sales_flow_id == flow.id,
    )
    if flow.is_default:
        scope = or_(
            scope,
            and_(Applications.id.is_(None), Payments.sales_flow_id.is_(None)),
        )
    return list(db.exec(statement.where(scope)).all())


def _due_flows(db: Session, now: datetime) -> list[tuple[SalesFlows, Popups]]:
    """Doors with check-in passes enabled and within their send window.

    The unit is a flow, not a popup: the check-in email's template has been
    flow-owned since the redesign, so when it goes out follows the wording it
    goes out in. A partner's door can write ahead of the event while the
    general one writes the week of.

    The window's other half stays the popup's, because the dates being counted
    back from are the event's — a flow has no start or end of its own.

    Window: ``start_date - lead_days <= now`` and (no end_date or
    ``now < end_date``). The post-start tail is intentional — tickets bought
    after the event begins are picked up by the next run without needing a
    separate code path.
    """
    due: list[tuple[SalesFlows, Popups]] = []
    for flow, popup in _flows_with_a_lead_time(db):
        lead = flow.checkin_pass_lead_days
        if not lead or lead <= 0:
            continue
        start = _as_utc(popup.start_date)
        if start is None:
            continue
        end = _as_utc(popup.end_date)
        send_from = start - timedelta(days=lead)
        if now < send_from:
            continue
        if end is not None and now >= end:
            continue
        due.append((flow, popup))
    return due


def _flows_with_a_lead_time(db: Session) -> list[tuple[SalesFlows, Popups]]:
    """Every flow that has asked for a check-in email, with its popup.

    The popup is joined rather than lazy-loaded so the window check and the
    tenant's sender details cost no extra query per flow.
    """
    statement = (
        select(SalesFlows, Popups)
        .join(Popups, SalesFlows.popup_id == Popups.id)  # type: ignore[arg-type]
        .where(
            SalesFlows.checkin_pass_lead_days.is_not(None),  # type: ignore[union-attr]
            Popups.start_date.is_not(None),  # type: ignore[union-attr]
        )
        .options(selectinload(Popups.tenant))  # type: ignore[arg-type]
    )
    return list(db.exec(statement).all())


async def _send_flow_passes(
    db: Session, flow: SalesFlows, popup: Popups, now: datetime
) -> dict:
    """Send (and mark) all due check-in passes for a single door.

    A direct purchase names no door, so the popup's default flow answers for
    those tickets — otherwise nobody would, and the buyer would never get a QR.
    """
    tickets = _find_unsent_units(db, flow, popup)
    if not tickets:
        return {"emails_sent": 0, "tickets_marked": 0, "failures": 0}

    # Group tickets by buyer (keyed by id — ORM objects aren't hashable);
    # drop tickets whose buyer has no email.
    by_buyer: dict[uuid.UUID, tuple[Humans, list[AttendeeProducts]]] = {}
    for ticket in tickets:
        buyer = _resolve_buyer(db, ticket)
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
    # Render the default subject from the template metadata so it's not
    # hardcoded here. Custom-template subjects (configured per popup) override
    # this inside EmailService when present.
    default_subject = render_default_subject(
        EmailTemplateType.CHECK_IN_PASS,
        {"popup_name": popup.name},
    )

    emails_sent = tickets_marked = failures = 0
    for buyer, buyer_tickets in by_buyer.values():
        try:
            qrs = [
                CheckInQrItem(
                    attendee_name=t.attendee.name if t.attendee else buyer.display_name,
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
                subject=default_subject,
                context=context,
                from_address=sender_email,
                from_name=sender_name,
                popup_id=popup.id,
                db_session=db,
            )
            if ok:
                # Mark after a successful send (at-least-once): a crash before
                # this leaves tickets unsent -> retried next run.
                attendees_crud.mark_checkin_pass_sent(db, buyer_tickets, now)
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
    due = _due_flows(db, now)
    summary = {
        "status": "ok",
        "popups_processed": 0,
        "flows_processed": 0,
        "emails_sent": 0,
        "tickets_marked": 0,
        "failures": 0,
    }
    seen_popups: set[uuid.UUID] = set()
    for flow, popup in due:
        result = await _send_flow_passes(db, flow, popup, now)
        summary["flows_processed"] += 1
        seen_popups.add(popup.id)
        summary["popups_processed"] = len(seen_popups)
        summary["emails_sent"] += result["emails_sent"]
        summary["tickets_marked"] += result["tickets_marked"]
        summary["failures"] += result["failures"]
    if summary["failures"]:
        logger.error(
            "Check-in pass dispatch finished with {} failures across {} popups",
            summary["failures"],
            summary["popups_processed"],
        )
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
