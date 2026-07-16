"""Automatic transition of active popups to the ``ended`` (recap) status.

Runs as a cross-tenant system job on the superuser session (RLS bypass),
mirroring app/services/checkin_pass_dispatch.py. A Postgres advisory lock makes
overlapping runs safe. The transition is idempotent: a popup already ``ended``
no longer matches the query.
"""

from datetime import UTC, datetime

from loguru import logger
from sqlalchemy import text
from sqlmodel import Session

from app.api.popup.crud import popups_crud
from app.api.popup.schemas import PopupStatus

# Unique advisory-lock key for the popup ended-transition job. Must differ from
# every other job key (checkin=4827133295, sweeper=7384925163).
ENDED_TRANSITION_ADVISORY_LOCK_KEY = 5391284770


def _run_transition(db: Session, now: datetime) -> dict:
    summary = {"status": "ok", "transitioned": 0, "failures": 0}
    for popup in popups_crud.list_active_past_end_date(db, now):
        try:
            popup.status = PopupStatus.ended
            db.add(popup)
            db.commit()
            summary["transitioned"] += 1
            logger.info("Popup {} transitioned to ended", popup.id)
        except Exception:  # noqa: BLE001 - isolate per-popup failures
            db.rollback()
            summary["failures"] += 1
            logger.exception("Failed to transition popup {} to ended", popup.id)
    if summary["failures"]:
        logger.error(
            "Popup ended-transition finished with {} failures", summary["failures"]
        )
    return summary


def transition_ended_popups(db: Session) -> dict:
    """Transition every active, past-end_date popup to ended.

    Holds a Postgres advisory lock on a dedicated connection so overlapping runs
    no-op instead of double-processing. Returns a summary dict.
    """
    now = datetime.now(UTC)
    lock_conn = db.get_bind().connect()
    try:
        got = lock_conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"),
            {"k": ENDED_TRANSITION_ADVISORY_LOCK_KEY},
        ).scalar()
        if not got:
            logger.info("Popup ended-transition already running; skipping")
            return {"status": "skipped", "reason": "another run is running"}
        try:
            return _run_transition(db, now)
        finally:
            lock_conn.execute(
                text("SELECT pg_advisory_unlock(:k)"),
                {"k": ENDED_TRANSITION_ADVISORY_LOCK_KEY},
            )
            lock_conn.commit()
    finally:
        lock_conn.close()
