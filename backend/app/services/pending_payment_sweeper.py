"""Pending payment sweeper service.

Finds PENDING SimpleFi payments older than the configured staleness threshold
and reconciles them with the current SimpleFi status:

  - approved / active / completed  → approve path (``_reconcile_approved``)
  - terminal (cancelled/expired/refunded) → ``update_status(EXPIRED)``
  - still pending on SimpleFi      → skip (retried next run)
  - status fetch fails             → skip + log (retried next run)

Popup with no ``simplefi_api_key`` → expire locally (orphaned payment);
same policy as ``supersede_pending_payments`` in ADR-2.

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
# SimpleFi statuses that mean the buyer actually paid.
_APPROVED_STATUSES = frozenset({"approved", "active", "completed"})


async def _reconcile_candidate(session: Session, payment: Payments) -> str:
    """Reconcile one stale PENDING payment against its current SimpleFi status.

    Returns a string action token for summary counters:
    - ``"expired"``            — payment expired locally, holds released
    - ``"approved_reconciled"`` — payment approved locally, confirmation email sent
    - ``"skipped_still_pending"`` — SimpleFi still shows pending, try next run
    - ``"skipped_no_key"``     — orphaned (no API key), expired locally
    - ``"skipped_error"``      — SimpleFi call failed, try next run

    Hard contract (ADR-5): NO SimpleFi HTTP call is made while holding any
    DB row lock.  Status is fetched first, then the row is locked inside
    ``update_status`` / ``_reconcile_approved``.
    """
    from app.api.popup.models import Popups

    popup = session.get(Popups, payment.popup_id)

    if popup is None or not popup.simplefi_api_key:
        # Orphaned payment: no live SimpleFi link to protect.  Expire locally
        # and release holds — same policy as supersede for orphaned payments.
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
        return "expired"

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

    if normalized in _APPROVED_STATUSES:
        # SimpleFi shows the buyer paid.  Idempotently approve and issue
        # tickets; send confirmation email best-effort (the webhook may have
        # been lost, leaving the buyer without email or products).
        approved_payment = payments_crud._reconcile_approved(session, payment)
        # Lazy import avoids circular dependency: the router module imports
        # from services, not the other way around.
        from app.api.payment.router import _send_payment_confirmed_email_best_effort

        await _send_payment_confirmed_email_best_effort(
            approved_payment, db_session=session
        )
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

    # Still pending on SimpleFi — the provider hasn't expired it yet.
    # Skip and retry on the next run.
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
        "approved_reconciled": 0,
        "skipped": 0,
        "failures": 0,
    }

    for payment in candidates:
        try:
            action = await _reconcile_candidate(session, payment)
            if action == "expired":
                summary["expired"] = int(summary["expired"]) + 1
            elif action == "approved_reconciled":
                summary["approved_reconciled"] = int(summary["approved_reconciled"]) + 1
            else:
                # "skipped_still_pending", "skipped_no_key", "skipped_error"
                summary["skipped"] = int(summary["skipped"]) + 1
        except Exception:
            # Unexpected error (e.g. DB failure during approve_payment).
            # Log and continue so other candidates are still processed.
            summary["failures"] = int(summary["failures"]) + 1
            logger.exception(
                "sweeper: unexpected error processing payment={} tenant={}; "
                "skipping candidate",
                payment.id,
                getattr(payment, "tenant_id", "?"),
            )

    logger.info(
        "sweeper: run complete candidates={} expired={} "
        "approved_reconciled={} skipped={} failures={}",
        summary["candidates"],
        summary["expired"],
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
    ``approved_reconciled``, ``skipped``, ``failures``.
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
