"""Defensive resource caps for self-serve trial tenants.

Trial tenants are capped at TRIAL_ATTENDEE_CAP attendees so an abusive or
runaway trial cannot hurt the platform. This is a defensive cap, not a
commercial one — enforcement FAILS OPEN when the trial status cannot be
determined (same philosophy as app.core.rate_limit).

The trial flag lives on the ``tenants`` table, which tenant-scoped DB roles
cannot read (REVOKEd since the initial schema). The lookup therefore runs on
the privileged main engine, mirroring app/api/check_in/router.py; tests patch
``app.services.trial_limits.engine`` to the testcontainer engine.
"""

import uuid

from cachetools import TTLCache
from fastapi import HTTPException, status
from loguru import logger
from sqlmodel import Session, func, select

from app.core.db import engine

TRIAL_ATTENDEE_CAP = 500

# Trial status rarely changes; cache 60s to avoid a main-engine round-trip on
# every attendee insert (same TTL as the authenticated-user cache).
_trial_flag_cache: TTLCache[uuid.UUID, bool] = TTLCache(maxsize=1000, ttl=60)


def _is_active_trial_tenant(tenant_id: uuid.UUID) -> bool:
    """True when the tenant is a trial (suspended or not). Fails open."""
    if tenant_id in _trial_flag_cache:
        return _trial_flag_cache[tenant_id]

    from app.api.tenant.models import Tenants

    try:
        with Session(engine) as session:
            is_trial = session.exec(
                select(Tenants.is_trial).where(Tenants.id == tenant_id)
            ).first()
    except Exception as exc:  # noqa: BLE001 — defensive cap, never block writes
        logger.warning(
            "trial_limits: could not resolve trial status for tenant {} — "
            "failing open: {}",
            tenant_id,
            exc,
        )
        return False

    result = bool(is_trial)
    _trial_flag_cache[tenant_id] = result
    return result


def enforce_trial_attendee_cap(session: Session, tenant_id: uuid.UUID) -> None:
    """Raise 422 when a trial tenant already has TRIAL_ATTENDEE_CAP attendees.

    ``session`` is the caller's (usually tenant-scoped) session — the count
    runs there, scoped by tenant_id. No-op for non-trial tenants.
    """
    if not _is_active_trial_tenant(tenant_id):
        return

    from app.api.attendee.models import Attendees

    count = session.exec(
        select(func.count())
        .select_from(Attendees)
        .where(Attendees.tenant_id == tenant_id)
    ).one()

    if count >= TRIAL_ATTENDEE_CAP:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Trial accounts are limited to {TRIAL_ATTENDEE_CAP} attendees. "
                "Contact us to upgrade your account."
            ),
        )
