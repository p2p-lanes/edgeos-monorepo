"""Defensive attendee cap for trial tenants (500 in production).

The cap is patched down to a small number so the test does not need to
insert hundreds of rows. Non-trial tenants are unaffected.
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.attendee.crud import attendees_crud
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.services import trial_limits


def _make_tenant_with_popup(db: Session, *, is_trial: bool) -> tuple[Tenants, Popups]:
    suffix = uuid.uuid4().hex[:8]
    tenant = Tenants(
        name=f"Cap Tenant {suffix}",
        slug=f"cap-tenant-{suffix}",
        is_trial=is_trial,
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    popup = Popups(
        name=f"Cap Popup {suffix}",
        slug=f"cap-popup-{suffix}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return tenant, popup


def _create_attendee(db: Session, tenant: Tenants, popup: Popups, n: int):
    return attendees_crud.create_internal(
        session=db,
        tenant_id=tenant.id,
        application_id=None,  # type: ignore[arg-type] — direct-style attendee
        popup_id=popup.id,
        name=f"Attendee {n}",
    )


def test_trial_tenant_hits_attendee_cap(db: Session, test_engine) -> None:
    tenant, popup = _make_tenant_with_popup(db, is_trial=True)

    with (
        patch("app.services.trial_limits.engine", test_engine),
        patch.object(trial_limits, "TRIAL_ATTENDEE_CAP", 2),
    ):
        _create_attendee(db, tenant, popup, 1)
        _create_attendee(db, tenant, popup, 2)

        with pytest.raises(HTTPException) as exc_info:
            _create_attendee(db, tenant, popup, 3)

    assert exc_info.value.status_code == 422
    assert "limited to 2 attendees" in exc_info.value.detail


def test_non_trial_tenant_is_not_capped(db: Session, test_engine) -> None:
    tenant, popup = _make_tenant_with_popup(db, is_trial=False)

    with (
        patch("app.services.trial_limits.engine", test_engine),
        patch.object(trial_limits, "TRIAL_ATTENDEE_CAP", 1),
    ):
        _create_attendee(db, tenant, popup, 1)
        _create_attendee(db, tenant, popup, 2)  # would exceed the cap if trial


def test_cap_fails_open_when_tenant_lookup_unavailable(db: Session) -> None:
    """The cap is defensive: if trial status cannot be resolved, writes go
    through (mirrors the fail-open rate limiter)."""
    tenant, popup = _make_tenant_with_popup(db, is_trial=True)

    class _BrokenEngine:
        def connect(self):  # pragma: no cover - signature only
            raise RuntimeError("db unavailable")

        def raw_connection(self):
            raise RuntimeError("db unavailable")

    with (
        patch("app.services.trial_limits.engine", _BrokenEngine()),
        patch.object(trial_limits, "TRIAL_ATTENDEE_CAP", 0),
    ):
        _create_attendee(db, tenant, popup, 1)
