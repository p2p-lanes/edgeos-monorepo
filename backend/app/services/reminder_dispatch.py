"""Reminder dispatch service — cross-tenant automatic reminder emails.

Runs as superuser (RLS bypass), iterating every SALES FLOW that has at least
one reminder configured (sdd/sales-flows slice 10 — the dispatch unit moved
from popup to flow; a popup with N flows is dispatched N times, once per
flow, each with its own cadence and history). For each configured reminder
type it finds eligible targets and sends the email, honoring the per-flow
cadence: first send N days after the triggering condition
(``*_delay_days``), repeat every M days (``*_repeat_days``, null = single
send), capped at K total sends (``*_max_count``). Cadence is resolved
per-flow via ``EffectiveFlowConfig`` (``sales_flow/resolver.py::
build_effective_config`` — flow value if set, else the popup's, design D1/D2:
this is that function's first production consumer). Cadence and cap are
derived from the ``email_logs`` history, so the job is idempotent and keeps
no tracking state of its own.

Three reminder types:
- abandoned_cart: a non-completed payment (expired/pending) whose buyer has no
  approved payment in the popup. Prices are recomputed from current products
  when they still exist, falling back to the payment snapshot otherwise.
- purchase_reminder: an accepted application with no approved payment.
- abandoned_application: an application left in draft (anchored on its last
  edit, ``updated_at``).

A null effective ``*_delay_days`` (flow value, else popup's) disables that
reminder for the flow, so an operator turns a reminder off simply by
clearing its delay at whichever tier it's currently set.

Candidate selection and dedupe both partition by flow (design's D7: reading
``sales_flow_id`` here is background/reporting partitioning, never a
request-path rule). A payment/application/email-log row with no
``sales_flow_id`` of its own (pre-migration data, or a row inserted by a
test that bypasses the real creation path) is treated as belonging to the
popup's DEFAULT flow rather than to no flow — see ``_scoped_to_flow`` and
``email_log/crud.py::get_reminder_stats``'s ``flow_is_default`` matching.
"""

import uuid
from datetime import UTC, datetime, timedelta

from loguru import logger
from sqlalchemy import ColumnElement, or_, text
from sqlmodel import Session, exists, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.email_log.crud import email_logs_crud
from app.api.email_template.schemas import EmailTemplateType
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.resolver import build_effective_config
from app.api.sales_flow.schemas import EffectiveFlowConfig
from app.services.email.service import get_email_service
from app.services.email.templates import (
    AbandonedApplicationContext,
    AbandonedCartContext,
    PaymentProductItem,
    PurchaseReminderContext,
)

# Session-level advisory lock key — must be distinct from every other job's key
# (SWEEP_ADVISORY_LOCK_KEY = 7384925163, TRIAL = 6203471958, check-in dispatch).
REMINDER_DISPATCH_ADVISORY_LOCK_KEY = 5821094736

# Safety ceiling for a repeat reminder configured without an explicit max_count,
# so a misconfiguration can never email someone unboundedly.
REMINDER_SAFETY_CAP = 12

# Payment states that represent an abandoned (never completed) checkout attempt.
_ABANDONED_PAYMENT_STATES = (PaymentStatus.EXPIRED.value, PaymentStatus.PENDING.value)

_DEFAULT_FIRST_NAME = "there"


def _should_send(
    *,
    sent_count: int,
    last_sent_at: datetime | None,
    delay_days: int,
    repeat_days: int | None,
    max_count: int | None,
    anchor: datetime,
    now: datetime,
) -> bool:
    """Decide whether a reminder is due for one target.

    First send fires ``delay_days`` after ``anchor``; each subsequent send
    fires ``repeat_days`` after the previous one, until the cap is reached.
    """
    effective_max = (
        max_count
        if max_count is not None
        else (1 if repeat_days is None else REMINDER_SAFETY_CAP)
    )
    if sent_count >= effective_max:
        return False
    if sent_count == 0:
        return now >= anchor + timedelta(days=delay_days)
    # A follow-up is only due when a repeat interval is configured.
    if repeat_days is None or last_sent_at is None:
        return False
    return now >= last_sent_at + timedelta(days=repeat_days)


def _scoped_to_flow(column: ColumnElement, flow: SalesFlows) -> ColumnElement:
    """Candidate-selection filter for one flow's dispatch (design D7).

    A row carrying this flow's own id always matches. A row with NO
    ``sales_flow_id`` (legacy data from before this slice's migration, or a
    test fixture that inserts rows directly) is treated as belonging to the
    popup's default flow rather than to no flow, so it is only matched when
    ``flow`` IS that popup's default — never picked up by a non-default
    flow, and never dispatched twice.
    """
    if flow.is_default:
        return or_(column == flow.id, column.is_(None))
    return column == flow.id


def _portal_passes_url(db: Session, popup: Popups) -> str | None:
    """Build the portal passes URL for a popup (respects custom domain)."""
    from app.api.tenant.models import Tenants
    from app.api.tenant.utils import get_portal_url

    tenant = db.get(Tenants, popup.tenant_id)
    if not tenant:
        return None
    base = get_portal_url(tenant).rstrip("/")
    return f"{base}/portal/{popup.slug}/passes"


def _portal_application_url(db: Session, popup: Popups) -> str | None:
    """Build the portal application URL for a popup (respects custom domain)."""
    from app.api.tenant.models import Tenants
    from app.api.tenant.utils import get_portal_url

    tenant = db.get(Tenants, popup.tenant_id)
    if not tenant:
        return None
    base = get_portal_url(tenant).rstrip("/")
    return f"{base}/portal/{popup.slug}/application"


def _payment_buyer(
    payment: Payments,
) -> tuple[str | None, str | None, uuid.UUID | None]:
    """Resolve (email, first_name, human_id) for a payment's buyer.

    Prefers the application human (application-based sale); falls back to the
    first product snapshot's attendee for direct sales.
    """
    if payment.application and payment.application.human:
        human = payment.application.human
        return human.email, human.first_name, human.id
    for pp in payment.products_snapshot:
        attendee = pp.attendee
        if not attendee:
            continue
        if attendee.human:
            return attendee.human.email, attendee.human.first_name, attendee.human.id
        return attendee.email, attendee.name, None
    return None, None, None


def _recompute_cart(
    db: Session, payment: Payments
) -> tuple[list[PaymentProductItem], float, str]:
    """Rebuild the product list and total for an abandoned payment.

    Uses each product's current price when the product still exists, otherwise
    falls back to the snapshot's effective unit price (or the snapshot price).
    """
    items: list[PaymentProductItem] = []
    total = 0.0
    currency = payment.currency or "USD"
    for pp in payment.products_snapshot:
        product = db.get(Products, pp.product_id) if pp.product_id else None
        if product is not None:
            unit = float(product.price)
        else:
            unit = float(pp.effective_unit_price or pp.product_price)
        total += unit * pp.quantity
        items.append(
            PaymentProductItem(name=pp.product_name, price=unit, quantity=pp.quantity)
        )
    return items, total, currency


async def _dispatch_abandoned_cart(
    db: Session,
    flow: SalesFlows,
    popup: Popups,
    effective: EffectiveFlowConfig,
    now: datetime,
    summary: dict,
) -> None:
    delay = effective.abandoned_cart_delay_days
    if delay is None:
        return

    # Emails that already completed a purchase in this popup (any flow) —
    # never remind them, regardless of which flow they'd abandon a cart in.
    paid_emails: set[str] = set()
    for paid in db.exec(
        select(Payments).where(
            Payments.popup_id == popup.id,
            Payments.status == PaymentStatus.APPROVED.value,
        )
    ).all():
        email = (paid.buyer_email or "").lower()
        if email:
            paid_emails.add(email)

    threshold = now - timedelta(days=delay)
    candidates = db.exec(
        select(Payments)
        .where(
            Payments.popup_id == popup.id,
            _scoped_to_flow(Payments.sales_flow_id, flow),  # type: ignore[arg-type]
            Payments.status.in_(_ABANDONED_PAYMENT_STATES),  # type: ignore[attr-defined]
            Payments.created_at <= threshold,
        )
        .order_by(Payments.created_at.desc())  # type: ignore[attr-defined]
    ).all()

    service = get_email_service()
    passes_url = _portal_passes_url(db, popup)
    seen: set[str] = set()
    for payment in candidates:
        email, first_name, human_id = _payment_buyer(payment)
        key = (email or "").lower()
        # One reminder series per buyer: skip duplicate attempts, buyers who
        # paid, and rows with no resolvable recipient.
        if not key or key in paid_emails or key in seen:
            continue
        seen.add(key)

        sent_count, last_sent_at = email_logs_crud.get_reminder_stats(
            db,
            template_type=EmailTemplateType.ABANDONED_CART.value,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            flow_is_default=flow.is_default,
            to_email=email,
        )
        if not _should_send(
            sent_count=sent_count,
            last_sent_at=last_sent_at,
            delay_days=delay,
            repeat_days=effective.abandoned_cart_repeat_days,
            max_count=effective.abandoned_cart_max_count,
            anchor=payment.created_at,
            now=now,
        ):
            summary["skipped"] += 1
            continue

        products, amount, currency = _recompute_cart(db, payment)
        context = AbandonedCartContext(
            first_name=first_name or _DEFAULT_FIRST_NAME,
            popup_name=popup.name,
            amount=amount,
            currency=currency,
            products=products,
            checkout_url=passes_url,
        )
        ok = await service.send_abandoned_cart(
            to=email,
            subject=f"Complete your purchase - {popup.name}",
            context=context,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            db_session=db,
            application_id=payment.application_id,
            payment_id=payment.id,
            human_id=human_id,
        )
        summary["sent" if ok else "failed"] += 1


async def _dispatch_purchase_reminder(
    db: Session,
    flow: SalesFlows,
    popup: Popups,
    effective: EffectiveFlowConfig,
    now: datetime,
    summary: dict,
) -> None:
    delay = effective.purchase_reminder_delay_days
    if delay is None:
        return

    threshold = now - timedelta(days=delay)
    approved_payment = exists().where(
        Payments.application_id == Applications.id,
        Payments.status == PaymentStatus.APPROVED.value,
    )
    candidates = db.exec(
        select(Applications).where(
            Applications.popup_id == popup.id,
            _scoped_to_flow(Applications.sales_flow_id, flow),  # type: ignore[arg-type]
            Applications.status == ApplicationStatus.ACCEPTED.value,
            Applications.accepted_at.is_not(None),  # type: ignore[attr-defined]
            Applications.accepted_at <= threshold,
            ~approved_payment,
        )
    ).all()

    service = get_email_service()
    for application in candidates:
        human = application.human
        if not human or not human.email:
            continue
        anchor = application.accepted_at
        if anchor is None:
            continue

        sent_count, last_sent_at = email_logs_crud.get_reminder_stats(
            db,
            template_type=EmailTemplateType.PURCHASE_REMINDER.value,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            flow_is_default=flow.is_default,
            application_id=application.id,
        )
        if not _should_send(
            sent_count=sent_count,
            last_sent_at=last_sent_at,
            delay_days=delay,
            repeat_days=effective.purchase_reminder_repeat_days,
            max_count=effective.purchase_reminder_max_count,
            anchor=anchor,
            now=now,
        ):
            summary["skipped"] += 1
            continue

        context = PurchaseReminderContext(
            first_name=human.first_name or _DEFAULT_FIRST_NAME,
        )
        ok = await service.send_purchase_reminder(
            to=human.email,
            subject=f"Complete your registration for {popup.name}",
            context=context,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            db_session=db,
            application_id=application.id,
            human_id=human.id,
        )
        summary["sent" if ok else "failed"] += 1


async def _dispatch_abandoned_application(
    db: Session,
    flow: SalesFlows,
    popup: Popups,
    effective: EffectiveFlowConfig,
    now: datetime,
    summary: dict,
) -> None:
    delay = effective.abandoned_application_delay_days
    if delay is None:
        return

    threshold = now - timedelta(days=delay)
    candidates = db.exec(
        select(Applications).where(
            Applications.popup_id == popup.id,
            _scoped_to_flow(Applications.sales_flow_id, flow),  # type: ignore[arg-type]
            Applications.status == ApplicationStatus.DRAFT.value,
            Applications.updated_at <= threshold,
        )
    ).all()

    service = get_email_service()
    application_url = _portal_application_url(db, popup)
    for application in candidates:
        human = application.human
        if not human or not human.email:
            continue

        sent_count, last_sent_at = email_logs_crud.get_reminder_stats(
            db,
            template_type=EmailTemplateType.ABANDONED_APPLICATION.value,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            flow_is_default=flow.is_default,
            application_id=application.id,
        )
        if not _should_send(
            sent_count=sent_count,
            last_sent_at=last_sent_at,
            delay_days=delay,
            repeat_days=effective.abandoned_application_repeat_days,
            max_count=effective.abandoned_application_max_count,
            anchor=application.updated_at,
            now=now,
        ):
            summary["skipped"] += 1
            continue

        context = AbandonedApplicationContext(
            first_name=human.first_name or _DEFAULT_FIRST_NAME,
            application_url=application_url,
        )
        ok = await service.send_abandoned_application(
            to=human.email,
            subject=f"Finish your application for {popup.name}",
            context=context,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            db_session=db,
            application_id=application.id,
            human_id=human.id,
        )
        summary["sent" if ok else "failed"] += 1


async def _run_dispatch(db: Session, now: datetime) -> dict:
    """Inner dispatch loop — runs after the advisory lock is held.

    Dispatch unit is one sales flow (sdd/sales-flows slice 10), not one
    popup: a popup's flow list is pre-filtered so only flows whose EFFECTIVE
    config (flow value, else the popup's — ``build_effective_config``) has
    at least one reminder delay set are dispatched, matching a flow that
    explicitly enables a reminder its popup left off, and a flow that
    inherits a popup-level reminder unchanged.
    """
    summary = {
        "status": "ok",
        "popups": 0,
        "flows": 0,
        "sent": 0,
        "failed": 0,
        "skipped": 0,
    }
    rows = db.exec(
        select(SalesFlows, Popups)
        .join(Popups, SalesFlows.popup_id == Popups.id)  # type: ignore[arg-type]
        .where(
            or_(
                SalesFlows.abandoned_cart_delay_days.is_not(None),  # type: ignore[attr-defined]
                Popups.abandoned_cart_delay_days.is_not(None),  # type: ignore[attr-defined]
                SalesFlows.purchase_reminder_delay_days.is_not(None),  # type: ignore[attr-defined]
                Popups.purchase_reminder_delay_days.is_not(None),  # type: ignore[attr-defined]
                SalesFlows.abandoned_application_delay_days.is_not(None),  # type: ignore[attr-defined]
                Popups.abandoned_application_delay_days.is_not(None),  # type: ignore[attr-defined]
            )
        )
    ).all()
    seen_popups: set[uuid.UUID] = set()
    for flow, popup in rows:
        summary["flows"] += 1
        seen_popups.add(popup.id)
        effective = build_effective_config(flow, popup)
        try:
            await _dispatch_abandoned_cart(db, flow, popup, effective, now, summary)
            await _dispatch_purchase_reminder(db, flow, popup, effective, now, summary)
            await _dispatch_abandoned_application(
                db, flow, popup, effective, now, summary
            )
        except Exception:
            logger.exception(
                "reminder_dispatch: flow {} (popup {}) raised; continuing",
                flow.id,
                popup.id,
            )
            summary["failed"] += 1
    summary["popups"] = len(seen_popups)
    return summary


async def dispatch_reminders(session: Session, *, now: datetime | None = None) -> dict:
    """Entry point for the reminder dispatcher.

    Acquires a session-level Postgres advisory lock on a dedicated connection
    so overlapping runs no-op instead of double-sending. The lock persists
    across the per-email log commits made during the run.

    Returns a summary dict with keys: ``status``, ``popups`` (distinct
    popups touched), ``flows`` (dispatch units — the loop's real
    granularity since sdd/sales-flows slice 10), ``sent``, ``failed``,
    ``skipped``.
    """
    now = now or datetime.now(UTC)
    lock_conn = session.get_bind().connect()
    try:
        got = lock_conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"),
            {"k": REMINDER_DISPATCH_ADVISORY_LOCK_KEY},
        ).scalar()
        if not got:
            logger.info(
                "reminder_dispatch: advisory lock held by another instance; skipping run"
            )
            return {"status": "skipped", "reason": "another dispatch is running"}

        try:
            return await _run_dispatch(session, now)
        finally:
            lock_conn.execute(
                text("SELECT pg_advisory_unlock(:k)"),
                {"k": REMINDER_DISPATCH_ADVISORY_LOCK_KEY},
            )
            lock_conn.commit()
    finally:
        lock_conn.close()
