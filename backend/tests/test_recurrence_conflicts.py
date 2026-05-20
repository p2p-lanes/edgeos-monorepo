"""Tests for the per-occurrence venue-conflict error message produced
when POST /events expands a recurrence and one of its instances clashes
with an existing booking.

Focus is on the new "Venue already booked on <Day Mon DD HH:MM TZ>"
prefix added by ``_check_recurrence_conflicts`` so users can read the
exact occurrence that triggered the 409 instead of guessing.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.router import _format_occurrence_label
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_venue.models import EventVenues
from app.api.event_venue.schemas import VenueBookingMode, VenueStatus
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Conflict Test {uuid.uuid4().hex[:6]}",
        slug=f"conflict-events-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_venue(db: Session, tenant: Tenants, popup: Popups) -> EventVenues:
    venue = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title=f"Conflict Venue {uuid.uuid4().hex[:4]}",
        status=VenueStatus.ACTIVE,
        booking_mode=VenueBookingMode.FREE,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


def _make_event(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    start: datetime,
    duration_hours: int = 1,
    venue_id: uuid.UUID | None = None,
    title: str = "Existing Event",
    rrule: str | None = None,
) -> Events:
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title=title,
        start_time=start,
        end_time=start + timedelta(hours=duration_hours),
        timezone="UTC",
        visibility=EventVisibility.PUBLIC,
        status=EventStatus.PUBLISHED,
        venue_id=venue_id,
        rrule=rrule,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


class TestRecurrenceConflictMessage:
    """409 detail should include the offending occurrence's local label."""

    def test_recurrence_409_includes_local_date(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)

        # Existing one-off blocks Wed 2026-06-10 16:00-17:00 UTC.
        blocker_start = datetime(2026, 6, 10, 16, 0, tzinfo=UTC)
        _make_event(
            db,
            tenant_a,
            popup,
            start=blocker_start,
            venue_id=venue.id,
            title="Morning Yoga",
        )

        series_start = datetime(2026, 6, 8, 16, 0, tzinfo=UTC)
        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "test 98",
                "start_time": series_start.isoformat(),
                "end_time": (series_start + timedelta(hours=1)).isoformat(),
                "timezone": "UTC",
                "venue_id": str(venue.id),
                "recurrence": {
                    "freq": "WEEKLY",
                    "interval": 1,
                    "by_day": ["MO", "TU", "WE", "TH"],
                    "count": 8,
                },
            },
        )

        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail.startswith("Venue already booked on "), detail
        assert "Wed Jun 10" in detail, detail
        assert "16:00" in detail, detail
        assert "(conflicts: Morning Yoga)" in detail, detail

    def test_non_recurring_409_message_unchanged(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)

        slot = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
        _make_event(
            db,
            tenant_a,
            popup,
            start=slot,
            venue_id=venue.id,
            title="Lunch",
        )

        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "Clashing one-off",
                "start_time": slot.isoformat(),
                "end_time": (slot + timedelta(hours=1)).isoformat(),
                "timezone": "UTC",
                "venue_id": str(venue.id),
            },
        )

        assert resp.status_code == 409, resp.text
        # Non-recurring path keeps the legacy bare message, no date prefix.
        assert resp.json()["detail"] == "Venue already booked (conflicts: Lunch)"


class TestFreedStatusesDoNotConflict:
    """CANCELLED and REJECTED events must release their venue slot."""

    def test_rejected_event_does_not_block_new_booking(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)

        slot = datetime(2026, 8, 4, 15, 0, tzinfo=UTC)
        rejected = _make_event(
            db,
            tenant_a,
            popup,
            start=slot,
            venue_id=venue.id,
            title="Rejected Request",
        )
        rejected.status = EventStatus.REJECTED
        db.add(rejected)
        db.commit()

        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "Replacement",
                "start_time": slot.isoformat(),
                "end_time": (slot + timedelta(hours=1)).isoformat(),
                "timezone": "UTC",
                "venue_id": str(venue.id),
            },
        )

        assert resp.status_code == 201, resp.text


class TestFormatOccurrenceLabel:
    """Direct coverage for the locale-independent label formatter."""

    def test_unknown_timezone_falls_back_to_utc(self) -> None:
        ts = datetime(2026, 6, 8, 16, 0, tzinfo=UTC)
        label = _format_occurrence_label(ts, "Mars/Olympus_Mons")
        # Garbage IANA → UTC; label should mention UTC and the UTC hour.
        assert "Mon" in label
        assert "Jun" in label
        assert "16:00" in label
        assert "UTC" in label

    def test_locale_independent_weekday_and_month(self) -> None:
        # Wed 2026-06-10 09:00 in America/Los_Angeles == 16:00 UTC.
        ts = datetime(2026, 6, 10, 16, 0, tzinfo=UTC)
        label = _format_occurrence_label(ts, "America/Los_Angeles")
        assert label.startswith("Wed Jun 10 09:00 ")
        # The trailing tz abbreviation comes from zoneinfo (PDT in June).
        assert label.endswith("PDT")
