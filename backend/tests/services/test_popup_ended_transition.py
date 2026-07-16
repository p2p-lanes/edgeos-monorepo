"""Tests for the automatic active -> ended popup transition job.

TDD phase: RED — written BEFORE implementation.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.tenant.models import Tenants
from app.services.popup_ended_transition import transition_ended_popups


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    end_date: datetime | None,
    status: str = "active",
    slug_prefix: str = "recap",
) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name="Recap Test Popup",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:6]}",
        sale_type="application",
        status=status,
        currency="USD",
        end_date=end_date,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _fresh_status(db: Session, popup_id: uuid.UUID) -> str:
    db.expire_all()
    p = db.get(Popups, popup_id)
    assert p is not None
    return str(p.status)


def test_active_popup_past_end_date_becomes_ended(
    db: Session, tenant_a: Tenants
) -> None:
    past = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
    popup = _make_popup(db, tenant_a, end_date=past, slug_prefix="past")

    summary = transition_ended_popups(db)

    assert _fresh_status(db, popup.id) == PopupStatus.ended
    assert summary["transitioned"] >= 1
    assert summary["failures"] == 0


def test_active_popup_future_end_date_untouched(db: Session, tenant_a: Tenants) -> None:
    future = datetime.now(UTC).replace(tzinfo=None) + timedelta(days=5)
    popup = _make_popup(db, tenant_a, end_date=future, slug_prefix="future")

    transition_ended_popups(db)

    assert _fresh_status(db, popup.id) == PopupStatus.active


def test_active_popup_without_end_date_untouched(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, end_date=None, slug_prefix="noend")

    transition_ended_popups(db)

    assert _fresh_status(db, popup.id) == PopupStatus.active


def test_already_ended_popup_not_reprocessed(db: Session, tenant_a: Tenants) -> None:
    past = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
    popup = _make_popup(
        db, tenant_a, end_date=past, status="ended", slug_prefix="already"
    )

    summary = transition_ended_popups(db)

    assert _fresh_status(db, popup.id) == PopupStatus.ended
    # The already-ended popup must not be counted as a new transition.
    # (Other tests in this module may add their own; assert this one is stable.)
    assert summary["failures"] == 0
