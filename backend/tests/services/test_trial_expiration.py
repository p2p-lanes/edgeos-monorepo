"""Tests for the trial expiration sweep (reminders + reversible suspension)."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from sqlmodel import Session

from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.services.email.service import EmailService
from app.services.trial_expiration import sweep_trial_expirations


def _make_trial_tenant(
    db: Session,
    *,
    expires_in: timedelta | None,
    is_trial: bool = True,
    suspended: bool = False,
    reminder_sent: bool = False,
) -> tuple[Tenants, Users]:
    suffix = uuid.uuid4().hex[:8]
    now = datetime.now(UTC)
    tenant = Tenants(
        name=f"Sweep Tenant {suffix}",
        slug=f"sweep-tenant-{suffix}",
        is_trial=is_trial,
        trial_expires_at=(now + expires_in) if expires_in is not None else None,
        suspended_at=now if suspended else None,
        trial_reminder_sent_at=now if reminder_sent else None,
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    user = Users(
        email=f"sweep-admin-{suffix}@example.com",
        role=UserRole.ADMIN,
        tenant_id=tenant.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return tenant, user


class _EmailRecorder:
    def __init__(self) -> None:
        self.reminders: list[str] = []
        self.ended: list[str] = []

    def patches(self):
        recorder = self

        async def _fake_reminder(*_args, **kwargs) -> bool:
            recorder.reminders.append(kwargs["to"])
            return True

        async def _fake_ended(*_args, **kwargs) -> bool:
            recorder.ended.append(kwargs["to"])
            return True

        return (
            patch.object(EmailService, "send_trial_reminder", _fake_reminder),
            patch.object(EmailService, "send_trial_ended", _fake_ended),
        )


def _run_sweep(db: Session, recorder: _EmailRecorder) -> dict:
    p1, p2 = recorder.patches()
    with p1, p2:
        return asyncio.run(sweep_trial_expirations(db))


def _fresh(db: Session, tenant_id: uuid.UUID) -> Tenants:
    db.expire_all()
    tenant = db.get(Tenants, tenant_id)
    assert tenant is not None
    return tenant


def test_expired_trial_is_suspended_and_notified_once(db: Session) -> None:
    tenant, user = _make_trial_tenant(db, expires_in=timedelta(hours=-1))
    recorder = _EmailRecorder()

    summary = _run_sweep(db, recorder)
    assert summary["status"] == "ok"

    refreshed = _fresh(db, tenant.id)
    assert refreshed.suspended_at is not None
    assert recorder.ended.count(user.email) == 1
    # Data intact: not soft-deleted, trial fields preserved
    assert refreshed.deleted is False
    assert refreshed.is_trial is True

    # Second run: already suspended — no double processing, no second email
    summary = _run_sweep(db, recorder)
    assert recorder.ended.count(user.email) == 1


def test_reminder_sent_once_within_two_day_window(db: Session) -> None:
    tenant, user = _make_trial_tenant(db, expires_in=timedelta(days=1))
    recorder = _EmailRecorder()

    _run_sweep(db, recorder)
    refreshed = _fresh(db, tenant.id)
    assert refreshed.trial_reminder_sent_at is not None
    assert refreshed.suspended_at is None  # not expired yet
    assert recorder.reminders.count(user.email) == 1

    # Idempotent: second run does not repeat the reminder
    _run_sweep(db, recorder)
    assert recorder.reminders.count(user.email) == 1


def test_no_reminder_outside_the_window(db: Session) -> None:
    tenant, user = _make_trial_tenant(db, expires_in=timedelta(days=5))
    recorder = _EmailRecorder()

    _run_sweep(db, recorder)
    refreshed = _fresh(db, tenant.id)
    assert refreshed.trial_reminder_sent_at is None
    assert user.email not in recorder.reminders


def test_non_trial_and_already_suspended_tenants_untouched(db: Session) -> None:
    non_trial, non_trial_user = _make_trial_tenant(
        db, expires_in=timedelta(hours=-1), is_trial=False
    )
    suspended, suspended_user = _make_trial_tenant(
        db, expires_in=timedelta(hours=-1), suspended=True
    )
    original_suspension = suspended.suspended_at
    recorder = _EmailRecorder()

    _run_sweep(db, recorder)

    assert _fresh(db, non_trial.id).suspended_at is None
    refreshed_suspended = _fresh(db, suspended.id)
    assert refreshed_suspended.suspended_at == original_suspension
    assert non_trial_user.email not in recorder.ended
    assert suspended_user.email not in recorder.ended


def test_overlapping_run_is_skipped_by_advisory_lock(db: Session, test_engine) -> None:
    from sqlalchemy import text

    from app.services.trial_expiration import TRIAL_EXPIRATION_ADVISORY_LOCK_KEY

    recorder = _EmailRecorder()
    holder = test_engine.connect()
    try:
        got = holder.execute(
            text("SELECT pg_try_advisory_lock(:k)"),
            {"k": TRIAL_EXPIRATION_ADVISORY_LOCK_KEY},
        ).scalar()
        assert got is True

        summary = _run_sweep(db, recorder)
        assert summary["status"] == "skipped"
    finally:
        holder.execute(
            text("SELECT pg_advisory_unlock(:k)"),
            {"k": TRIAL_EXPIRATION_ADVISORY_LOCK_KEY},
        )
        holder.commit()
        holder.close()
