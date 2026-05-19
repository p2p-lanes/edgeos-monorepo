"""Tests for POST /events/check-recurring-availability.

This endpoint is the recurrence-aware preflight that powers the event
form's availability indicator. It expands the requested RRULE and reports
every offending occurrence (capped at 20) instead of bailing on the first
conflict like the create path's 409.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_venue.models import EventVenues
from app.api.event_venue.schemas import VenueBookingMode, VenueStatus
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"RecurAvail {uuid.uuid4().hex[:6]}",
        slug=f"recur-avail-{uuid.uuid4().hex[:10]}",
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
        title=f"RecurAvail Venue {uuid.uuid4().hex[:4]}",
        status=VenueStatus.ACTIVE,
        booking_mode=VenueBookingMode.FREE,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


def _make_blocker(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    venue: EventVenues,
    *,
    start: datetime,
    title: str,
    duration_hours: int = 1,
) -> Events:
    ev = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title=title,
        start_time=start,
        end_time=start + timedelta(hours=duration_hours),
        timezone="UTC",
        visibility=EventVisibility.PUBLIC,
        status=EventStatus.PUBLISHED,
        venue_id=venue.id,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


class TestCheckRecurringAvailability:
    """POST /events/check-recurring-availability."""

    def test_clean_recurrence_returns_available_true(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)

        start = datetime(2026, 8, 3, 14, 0, tzinfo=UTC)
        resp = client.post(
            "/api/v1/events/check-recurring-availability",
            headers=_auth(admin_token_tenant_a),
            json={
                "venue_id": str(venue.id),
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
                "timezone": "UTC",
                "recurrence": {
                    "freq": "WEEKLY",
                    "interval": 1,
                    "by_day": ["MO"],
                    "count": 4,
                },
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["available"] is True
        assert body["total_occurrences"] == 4
        assert body["conflicts"] == []
        assert body["truncated"] is False

    def test_one_conflicting_occurrence_returned_with_label_and_titles(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)

        # Existing one-off blocks Mon 2026-08-10 14:00 UTC.
        _make_blocker(
            db,
            tenant_a,
            popup,
            venue,
            start=datetime(2026, 8, 10, 14, 0, tzinfo=UTC),
            title="Morning Yoga",
        )

        series_start = datetime(2026, 8, 3, 14, 0, tzinfo=UTC)
        resp = client.post(
            "/api/v1/events/check-recurring-availability",
            headers=_auth(admin_token_tenant_a),
            json={
                "venue_id": str(venue.id),
                "start_time": series_start.isoformat(),
                "end_time": (series_start + timedelta(hours=1)).isoformat(),
                "timezone": "UTC",
                "recurrence": {
                    "freq": "WEEKLY",
                    "interval": 1,
                    "by_day": ["MO"],
                    "count": 4,
                },
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["available"] is False
        assert body["total_occurrences"] == 4
        assert len(body["conflicts"]) == 1
        conflict = body["conflicts"][0]
        assert conflict["conflicting_titles"] == ["Morning Yoga"]
        assert conflict["local_label"].startswith("Mon Aug 10")
        assert "14:00" in conflict["local_label"]
        assert conflict["reason"].startswith("Venue already booked (")
        assert body["truncated"] is False

    def test_truncates_after_20_conflicts(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)

        # Block the venue every day for 30 days; the daily recurrence we
        # request below will conflict on every single one of them.
        series_start = datetime(2026, 9, 1, 14, 0, tzinfo=UTC)
        for offset in range(30):
            _make_blocker(
                db,
                tenant_a,
                popup,
                venue,
                start=series_start + timedelta(days=offset),
                title=f"Block {offset}",
            )

        resp = client.post(
            "/api/v1/events/check-recurring-availability",
            headers=_auth(admin_token_tenant_a),
            json={
                "venue_id": str(venue.id),
                "start_time": series_start.isoformat(),
                "end_time": (series_start + timedelta(hours=1)).isoformat(),
                "timezone": "UTC",
                "recurrence": {
                    "freq": "DAILY",
                    "interval": 1,
                    "count": 30,
                },
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["available"] is False
        assert body["truncated"] is True
        assert len(body["conflicts"]) == 20
        # checked_occurrences stops at the truncation point, not the full
        # series length, since we bail on the cap.
        assert body["checked_occurrences"] == 20
        assert body["total_occurrences"] == 30
