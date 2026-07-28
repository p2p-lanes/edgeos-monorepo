"""Trial expiration sweep: reminders + reversible suspension.

Runs as a cross-tenant system job on the superuser session (the ``tenants``
table is global), mirroring app/services/popup_ended_transition.py. A
Postgres advisory lock makes overlapping runs safe.

Two passes, both idempotent:

1. Reminder — trials expiring in <= REMINDER_WINDOW_DAYS get a "2 days left"
   email, sent at most once (``trial_reminder_sent_at`` is the flag).
2. Suspension — expired trials get ``suspended_at = now()`` plus a
   "trial ended" email. Already-suspended tenants no longer match the query.
   Suspension is reversible: data and PG credentials stay intact; a
   superadmin reactivates by clearing ``suspended_at``.
"""

from datetime import UTC, datetime, timedelta

from loguru import logger
from sqlalchemy import text
from sqlmodel import Session, not_, select

from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.config import settings
from app.core.redis import domain_cache
from app.services.email import (
    TrialEndedContext,
    TrialReminderContext,
    get_email_service,
)

# Unique advisory-lock key for the trial expiration job. Must differ from
# every other job key (checkin=4827133295, sweeper=7384925163,
# popup_ended=5391284770).
TRIAL_EXPIRATION_ADVISORY_LOCK_KEY = 6203471958

REMINDER_WINDOW_DAYS = 2


def _admin_emails(db: Session, tenant_id) -> list[str]:
    """Emails of the tenant's non-deleted ADMIN users (trial founders)."""
    rows = db.exec(
        select(Users.email).where(
            Users.tenant_id == tenant_id,
            Users.role == UserRole.ADMIN,
            not_(Users.deleted),
        )
    ).all()
    return list(rows)


def _invalidate_tenant_domains(tenant: Tenants) -> None:
    """Drop cached by-domain entries so suspension takes effect promptly.

    The cache key is the host the portal requested; we cover both known
    shapes (custom domain and platform subdomain). Any other cached host
    ages out with the cache's 5-minute TTL.
    """
    if tenant.custom_domain:
        domain_cache.invalidate(tenant.custom_domain)
    if settings.PORTAL_DOMAIN:
        domain_cache.invalidate(f"{tenant.slug}.{settings.PORTAL_DOMAIN}")


async def _send_reminders(db: Session, now: datetime, summary: dict) -> None:
    deadline = now + timedelta(days=REMINDER_WINDOW_DAYS)
    tenants = db.exec(
        select(Tenants).where(
            Tenants.is_trial == True,  # noqa: E712
            Tenants.deleted == False,  # noqa: E712
            Tenants.suspended_at.is_(None),  # type: ignore[union-attr]
            Tenants.trial_reminder_sent_at.is_(None),  # type: ignore[union-attr]
            Tenants.trial_expires_at.is_not(None),  # type: ignore[union-attr]
            Tenants.trial_expires_at > now,  # type: ignore[operator]
            Tenants.trial_expires_at <= deadline,  # type: ignore[operator]
        )
    ).all()

    email_service = get_email_service()
    for tenant in tenants:
        try:
            expires_at = tenant.trial_expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            context = TrialReminderContext(
                gathering_name=tenant.name,
                backoffice_url=settings.BACKOFFICE_URL,
                expires_on=expires_at.strftime("%B %d, %Y"),
            )
            for email in _admin_emails(db, tenant.id):
                await email_service.send_trial_reminder(
                    to=email,
                    subject=f"2 days left in your {settings.PROJECT_NAME} trial",
                    context=context,
                    db_session=db,
                )
            # Mark AFTER sending so a failed send retries next run; a failed
            # commit at worst re-sends once.
            tenant.trial_reminder_sent_at = now
            db.add(tenant)
            db.commit()
            summary["reminded"] += 1
            logger.info("Trial reminder sent for tenant {}", tenant.id)
        except Exception:  # noqa: BLE001 — isolate per-tenant failures
            db.rollback()
            summary["failures"] += 1
            logger.exception("Failed to send trial reminder for tenant {}", tenant.id)


async def _suspend_expired(db: Session, now: datetime, summary: dict) -> None:
    tenants = db.exec(
        select(Tenants).where(
            Tenants.is_trial == True,  # noqa: E712
            Tenants.deleted == False,  # noqa: E712
            Tenants.suspended_at.is_(None),  # type: ignore[union-attr]
            Tenants.trial_expires_at.is_not(None),  # type: ignore[union-attr]
            Tenants.trial_expires_at < now,  # type: ignore[operator]
        )
    ).all()

    email_service = get_email_service()
    for tenant in tenants:
        try:
            tenant.suspended_at = now
            db.add(tenant)
            db.commit()
            _invalidate_tenant_domains(tenant)

            context = TrialEndedContext(gathering_name=tenant.name)
            for email in _admin_emails(db, tenant.id):
                sent = await email_service.send_trial_ended(
                    to=email,
                    subject=f"Your {settings.PROJECT_NAME} trial has ended",
                    context=context,
                    db_session=db,
                )
                if not sent:
                    logger.error(
                        "Failed to send trial-ended email to {} (tenant {})",
                        email,
                        tenant.id,
                    )
            summary["suspended"] += 1
            logger.info("Trial tenant {} suspended (expired)", tenant.id)
        except Exception:  # noqa: BLE001 — isolate per-tenant failures
            db.rollback()
            summary["failures"] += 1
            logger.exception("Failed to suspend trial tenant {}", tenant.id)


async def _run_sweep(db: Session, now: datetime) -> dict:
    summary = {"status": "ok", "reminded": 0, "suspended": 0, "failures": 0}
    await _send_reminders(db, now, summary)
    await _suspend_expired(db, now, summary)
    if summary["failures"]:
        logger.error(
            "Trial expiration sweep finished with {} failures", summary["failures"]
        )
    return summary


async def sweep_trial_expirations(db: Session) -> dict:
    """Send due reminders and suspend expired trials.

    Holds a Postgres advisory lock on a dedicated connection so overlapping
    runs no-op instead of double-processing. Returns a summary dict.
    """
    now = datetime.now(UTC)
    lock_conn = db.get_bind().connect()
    try:
        got = lock_conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"),
            {"k": TRIAL_EXPIRATION_ADVISORY_LOCK_KEY},
        ).scalar()
        if not got:
            logger.info("Trial expiration sweep already running; skipping")
            return {"status": "skipped", "reason": "another run is running"}
        try:
            return await _run_sweep(db, now)
        finally:
            lock_conn.execute(
                text("SELECT pg_advisory_unlock(:k)"),
                {"k": TRIAL_EXPIRATION_ADVISORY_LOCK_KEY},
            )
            lock_conn.commit()
    finally:
        lock_conn.close()
