"""Pending payment sweeper service.

Finds PENDING SimpleFi payments older than the configured staleness threshold
and reconciles them with the current SimpleFi status:

  - one-shot request approved              → approve path (``_reconcile_approved``)
  - installment plan with a charged cuota  → approve path (``_reconcile_approved``)
  - terminal (cancelled/expired/refunded)  → ``update_status(EXPIRED)``
  - still pending on SimpleFi               → skip (retried next run)
  - status fetch fails                      → skip + log (retried next run)

For installment plans the approve gate is ``paid_installments_count >= 1`` (or a
``completed`` plan), NOT the ``active`` status: an activated plan can still have
zero installments charged.  Our Payment row represents only the first cuota, so
approving on ``active`` alone would assign products before any money cleared.

The sweeper never sends a confirmation email; it only reconciles state.  Email
delivery stays owned by the webhook path.

Popup with no ``simplefi_api_key`` → expire locally (``expired_orphaned``
action); same policy as ``supersede_pending_payments`` in ADR-2.  These are
counted separately from plain ``expired`` so ops can distinguish SimpleFi-
confirmed expirations from local-only ones.

Runs as a standalone cross-tenant job using the superuser engine (RLS bypass),
mirroring ``app/jobs/checkin_pass_dispatch.py``.  The service itself holds the
Postgres advisory lock so the job entrypoint stays thin.

Design reference: ADR-5 (pending-payment-hold-release).
"""

from loguru import logger
from sqlalchemy import text
from sqlmodel import Session

from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
from app.services.simplefi import get_simplefi_client

# Session-level advisory lock key — must be distinct from every other job's
# lock key in the codebase.  DISPATCH_ADVISORY_LOCK_KEY = 4827133295 (check-in
# pass dispatch).  Use a well-separated constant to avoid accidental conflicts.
SWEEP_ADVISORY_LOCK_KEY = 7384925163

# SimpleFi statuses that indicate the provider already cancelled the payment.
_TERMINAL_STATUSES = frozenset({"canceled", "cancelled", "expired", "refunded"})
# SimpleFi statuses that mean a one-shot payment request was actually paid.
# Installment plans do NOT use this set — they gate on paid_installments_count
# (see _reconcile_candidate), because "active" means "plan activated", not
# "first cuota charged".
_APPROVED_STATUSES = frozenset({"approved", "active", "completed"})


async def _reconcile_candidate(session: Session, payment: Payments) -> str:
    """Reconcile one stale PENDING payment against its current SimpleFi status.

    Returns a string action token for summary counters:
    - ``"expired"``              — SimpleFi-confirmed terminal, holds released
    - ``"expired_orphaned"``     — no API key to check; expired locally
    - ``"approved_reconciled"``  — payment approved (no email sent by the sweeper)
    - ``"skipped_still_pending"``— SimpleFi still shows pending, try next run
    - ``"skipped_error"``        — SimpleFi call failed, try next run

    Hard contract (ADR-5): NO SimpleFi HTTP call is made while holding any
    DB row lock.  Status is fetched first, then the row is locked inside
    ``update_status`` / ``_reconcile_approved``.
    """
    from app.api.popup.models import Popups

    popup = session.get(Popups, payment.popup_id)

    if popup is None or not popup.simplefi_api_key:
        # Orphaned payment: no live SimpleFi link to protect.  Expire locally
        # and release holds — same policy as supersede for orphaned payments.
        # Counted as "expired_orphaned", NOT as plain "expired", so the
        # summary clearly separates SimpleFi-confirmed expirations from
        # local-only ones driven by missing configuration.
        logger.warning(
            "sweeper: orphaned payment (no simplefi_api_key) "
            "popup={} payment={} tenant={}",
            payment.popup_id,
            payment.id,
            payment.tenant_id,
        )
        payments_crud.update_status(session, payment.id, PaymentStatus.EXPIRED)
        logger.info(
            "sweeper: payment={} tenant={} action=swept_to_expired simplefi_status=orphaned",
            payment.id,
            payment.tenant_id,
        )
        return "expired_orphaned"

    simplefi_client = get_simplefi_client(popup.simplefi_api_key)

    # Fetch current status from SimpleFi OUTSIDE any DB lock (ADR-5).
    try:
        if payment.is_installment_plan:
            status_resp = simplefi_client.get_installment_plan_status(
                str(payment.external_id)
            )
        else:
            status_resp = simplefi_client.get_payment_request_status(
                str(payment.external_id)
            )
    except Exception as exc:
        logger.warning(
            "sweeper: status fetch failed payment={} tenant={} error={!r}; "
            "skipping this candidate",
            payment.id,
            payment.tenant_id,
            exc,
        )
        return "skipped_error"

    normalized = status_resp.status.lower().strip()

    if payment.is_installment_plan:
        # For a plan our Payment row represents only the first cuota. "active"
        # means the plan was activated, not that a cuota cleared, so gate on
        # paid_installments_count instead: >= 1 means the buyer paid at least
        # the first installment. A "completed" plan is paid by definition.
        paid_count = status_resp.paid_installments_count or 0
        buyer_paid = normalized == "completed" or paid_count >= 1
    else:
        buyer_paid = normalized in _APPROVED_STATUSES

    if buyer_paid:
        # SimpleFi shows the buyer paid.  Idempotently approve and issue
        # tickets (the webhook may have been lost, leaving the buyer without
        # products).  The sweeper does NOT send a confirmation email — that
        # stays owned by the webhook path.
        payments_crud._reconcile_approved(session, payment)
        logger.info(
            "sweeper: payment={} tenant={} action=approved_reconciled simplefi_status={}",
            payment.id,
            payment.tenant_id,
            normalized,
        )
        return "approved_reconciled"

    if normalized in _TERMINAL_STATUSES:
        # SimpleFi cancelled/expired the payment.  Release holds.
        payments_crud.update_status(session, payment.id, PaymentStatus.EXPIRED)
        logger.info(
            "sweeper: payment={} tenant={} action=swept_to_expired simplefi_status={}",
            payment.id,
            payment.tenant_id,
            normalized,
        )
        return "expired"

    # Still pending on SimpleFi — skip and retry on the next run.
    #
    # Safety invariant: SimpleFi's own checkout expiry is approximately
    # 15 minutes, which is BELOW PENDING_SWEEP_STALE_MINUTES (20 min).
    # A "still-pending" report therefore means the buyer MAY be actively
    # completing the payment right now.  The sweeper NEVER expires a payment
    # that SimpleFi reports as still-pending; it only expires what SimpleFi
    # has confirmed as terminal, or what has no API key to check.
    # See PENDING_SWEEP_STALE_MINUTES in app/jobs/pending_payment_sweeper.py.
    logger.info(
        "sweeper: payment={} tenant={} action=skipped simplefi_status={}",
        payment.id,
        payment.tenant_id,
        normalized,
    )
    return "skipped_still_pending"


async def _run_sweep(
    session: Session,
    *,
    threshold_minutes: int,
    batch_size: int,
) -> dict:
    """Inner sweep loop — runs after the advisory lock is held."""
    candidates = payments_crud.get_stale_pending_payments(
        session, threshold_minutes, batch_size
    )

    summary: dict[str, int | str] = {
        "candidates": len(candidates),
        "expired": 0,
        "expired_orphaned": 0,
        "approved_reconciled": 0,
        "skipped": 0,
        "failures": 0,
    }

    for payment in candidates:
        try:
            action = await _reconcile_candidate(session, payment)
            if action == "expired":
                summary["expired"] = int(summary["expired"]) + 1
            elif action == "expired_orphaned":
                summary["expired_orphaned"] = int(summary["expired_orphaned"]) + 1
            elif action == "approved_reconciled":
                summary["approved_reconciled"] = int(summary["approved_reconciled"]) + 1
            else:
                # "skipped_still_pending", "skipped_error"
                summary["skipped"] = int(summary["skipped"]) + 1
        except Exception:
            # Unexpected error (e.g. DB failure during approve_payment).
            # Roll back the current transaction so any partial writes from
            # this candidate (staged ORM changes, open row locks) are
            # discarded before the next candidate is processed.  Without this
            # rollback, a staged-but-uncommitted change (e.g. a coupon use
            # decrement from update_status) can be flushed and committed by
            # the next candidate's session.commit(), leaking the hold even
            # though the payment remains PENDING.
            session.rollback()
            summary["failures"] = int(summary["failures"]) + 1
            logger.exception(
                "sweeper: unexpected error processing payment={} tenant={}; "
                "skipping candidate",
                payment.id,
                getattr(payment, "tenant_id", "?"),
            )

    logger.info(
        "sweeper: run complete candidates={} expired={} expired_orphaned={} "
        "approved_reconciled={} skipped={} failures={}",
        summary["candidates"],
        summary["expired"],
        summary["expired_orphaned"],
        summary["approved_reconciled"],
        summary["skipped"],
        summary["failures"],
    )
    return summary


async def sweep_pending_payments(
    session: Session,
    *,
    threshold_minutes: int,
    batch_size: int,
) -> dict:
    """Entry point for the pending-payment sweeper.

    Acquires a Postgres session-level advisory lock (``pg_try_advisory_lock``)
    on a dedicated connection so overlapping runs no-op instead of
    double-processing candidates.  Session-level locking (not
    ``xact``-scoped) is correct here because the sweeper is a standalone
    long-running process on a dedicated connection; the lock must persist
    across the multiple ``session.commit()`` calls made by ``update_status``
    during the run.

    Returns a summary dict with keys: ``status``, ``candidates``, ``expired``,
    ``expired_orphaned``, ``approved_reconciled``, ``skipped``, ``failures``.
    """
    lock_conn = session.get_bind().connect()
    try:
        got = lock_conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"),
            {"k": SWEEP_ADVISORY_LOCK_KEY},
        ).scalar()
        if not got:
            logger.info("sweeper: advisory lock held by another instance; skipping run")
            return {"status": "skipped", "reason": "another sweep is running"}

        try:
            result = await _run_sweep(
                session,
                threshold_minutes=threshold_minutes,
                batch_size=batch_size,
            )
            result["status"] = "ok"
            return result
        finally:
            lock_conn.execute(
                text("SELECT pg_advisory_unlock(:k)"),
                {"k": SWEEP_ADVISORY_LOCK_KEY},
            )
            lock_conn.commit()
    finally:
        lock_conn.close()
