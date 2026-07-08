"""Tests for popups_crud.get_recap_stats.

TDD phase: RED — written BEFORE implementation.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlmodel import Session

from app.api.attendee.models import Attendees
from app.api.event.models import Events
from app.api.popup.crud import popups_crud
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    show_directory: bool,
    start: datetime | None,
    end: datetime | None,
) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name="Recap Stats Popup",
        slug=f"stats-{uuid.uuid4().hex[:6]}",
        sale_type="application",
        status="ended",
        currency="USD",
        start_date=start,
        end_date=end,
        show_attendee_directory=show_directory,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _add_event(db: Session, popup: Popups, *, status: str) -> None:
    now = datetime.now(UTC)
    db.add(
        Events(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            owner_id=uuid.uuid4(),
            title="Event",
            start_time=now,
            end_time=now + timedelta(hours=1),
            status=status,
        )
    )
    db.commit()


def _add_attendee(db: Session, popup: Popups) -> None:
    db.add(Attendees(tenant_id=popup.tenant_id, popup_id=popup.id, name="Alice"))
    db.commit()


def test_counts_published_events_only(db: Session, tenant_a: Tenants) -> None:
    popup = _make_popup(db, tenant_a, show_directory=True, start=None, end=None)
    _add_event(db, popup, status="published")
    _add_event(db, popup, status="published")
    _add_event(db, popup, status="draft")

    events_count, _attendees, _days = popups_crud.get_recap_stats(db, popup)

    assert events_count == 2


def test_attendees_counted_only_when_directory_enabled(db: Session, tenant_a: Tenants) -> None:
    popup_on = _make_popup(db, tenant_a, show_directory=True, start=None, end=None)
    _add_attendee(db, popup_on)
    popup_off = _make_popup(db, tenant_a, show_directory=False, start=None, end=None)
    _add_attendee(db, popup_off)

    _e_on, attendees_on, _d_on = popups_crud.get_recap_stats(db, popup_on)
    _e_off, attendees_off, _d_off = popups_crud.get_recap_stats(db, popup_off)

    assert attendees_on == 1
    assert attendees_off == 0


def test_days_is_inclusive_span(db: Session, tenant_a: Tenants) -> None:
    start = datetime(2025, 3, 1, tzinfo=UTC).replace(tzinfo=None)
    end = datetime(2025, 3, 7, tzinfo=UTC).replace(tzinfo=None)
    popup = _make_popup(db, tenant_a, show_directory=True, start=start, end=end)

    _e, _a, days = popups_crud.get_recap_stats(db, popup)

    assert days == 7  # Mar 1..Mar 7 inclusive
