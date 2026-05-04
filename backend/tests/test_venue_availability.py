"""Integration tests for venue availability computation.

Exercises GET /event-venues/{id}/availability (the backoffice-side endpoint)
and, through it, the shared _compute_availability helper.

Covers invariants:
- Weekly hours open an interval on the matching day.
- Popup timezone shifts the open window relative to UTC.
- Overnight hours (close <= open) span the day boundary.
- Closed exceptions surface as busy slots with source="exception".
- Open exceptions add an open range even on a day with no weekly hours.
- Event busy slots extend by setup/teardown buffers.
- Cancelled events are excluded from busy slots.
- end <= start is rejected with 400.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.event_venue.models import (
    EventVenues,
    VenueExceptions,
    VenueWeeklyHours,
)
from app.api.event_venue.schemas import VenueBookingMode, VenueStatus
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _make_popup(db: Session, tenant: Tenants, *, tz: str = "UTC") -> Popups:
    popup = Popups(
        name=f"Availability Test {uuid.uuid4().hex[:6]}",
        slug=f"avail-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.flush()
    db.add(
        EventSettings(
            tenant_id=tenant.id,
            popup_id=popup.id,
            timezone=tz,
        )
    )
    db.commit()
    db.refresh(popup)
    return popup


def _make_venue(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    setup_minutes: int = 0,
    teardown_minutes: int = 0,
) -> EventVenues:
    venue = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title="Availability Test Venue",
        setup_time_minutes=setup_minutes,
        teardown_time_minutes=teardown_minutes,
        status=VenueStatus.ACTIVE,
        booking_mode=VenueBookingMode.FREE,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


def _add_weekly(
    db: Session,
    venue: EventVenues,
    dow: int,
    *,
    open_t: time | None,
    close_t: time | None,
    is_closed: bool = False,
) -> None:
    db.add(
        VenueWeeklyHours(
            tenant_id=venue.tenant_id,
            venue_id=venue.id,
            day_of_week=dow,
            open_time=open_t,
            close_time=close_t,
            is_closed=is_closed,
        )
    )
    db.commit()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _get_availability(
    client: TestClient,
    venue: EventVenues,
    token: str,
    *,
    start: datetime,
    end: datetime,
) -> tuple[int, dict]:
    resp = client.get(
        f"/api/v1/event-venues/{venue.id}/availability",
        params={"start": start.isoformat(), "end": end.isoformat()},
        headers=_auth(token),
    )
    # Caller asserts status code; json() only safe on 2xx but we need both.
    try:
        body = resp.json()
    except Exception:
        body = {}
    return resp.status_code, body


class TestVenueAvailability:
    """GET /event-venues/{id}/availability."""

    def test_basic_open_range_utc(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a, tz="UTC")
        venue = _make_venue(db, tenant_a, popup)
        # 2026-04-13 is a Monday → dow 0.
        _add_weekly(db, venue, 0, open_t=time(9), close_t=time(17))

        status_code, data = _get_availability(
            client,
            venue,
            admin_token_tenant_a,
            start=datetime(2026, 4, 13, 0, 0, tzinfo=UTC),
            end=datetime(2026, 4, 14, 0, 0, tzinfo=UTC),
        )

        assert status_code == 200, data
        assert data["timezone"] == "UTC"
        assert data["busy"] == []
        assert len(data["open_ranges"]) == 1
        got = data["open_ranges"][0]
        assert datetime.fromisoformat(got["start"]) == datetime(
            2026, 4, 13, 9, 0, tzinfo=UTC
        )
        assert datetime.fromisoformat(got["end"]) == datetime(
            2026, 4, 13, 17, 0, tzinfo=UTC
        )

    def test_popup_timezone_shifts_window(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """09:00 in Buenos Aires (UTC-3) must resolve to 12:00 UTC."""
        tz_name = "America/Argentina/Buenos_Aires"
        tz = ZoneInfo(tz_name)
        popup = _make_popup(db, tenant_a, tz=tz_name)
        venue = _make_venue(db, tenant_a, popup)
        _add_weekly(db, venue, 0, open_t=time(9), close_t=time(17))

        start_local = datetime(2026, 4, 13, 0, 0, tzinfo=tz)
        end_local = datetime(2026, 4, 14, 0, 0, tzinfo=tz)
        status_code, data = _get_availability(
            client,
            venue,
            admin_token_tenant_a,
            start=start_local.astimezone(UTC),
            end=end_local.astimezone(UTC),
        )

        assert status_code == 200, data
        assert data["timezone"] == tz_name
        assert len(data["open_ranges"]) == 1
        got = data["open_ranges"][0]
        expected_start = datetime(2026, 4, 13, 9, 0, tzinfo=tz).astimezone(UTC)
        expected_end = datetime(2026, 4, 13, 17, 0, tzinfo=tz).astimezone(UTC)
        assert datetime.fromisoformat(got["start"]).astimezone(UTC) == expected_start
        assert datetime.fromisoformat(got["end"]).astimezone(UTC) == expected_end

    def test_overnight_hours_span_day_boundary(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a, tz="UTC")
        venue = _make_venue(db, tenant_a, popup)
        # Friday = dow 4; 22:00 → 02:00 next day.
        _add_weekly(db, venue, 4, open_t=time(22), close_t=time(2))

        status_code, data = _get_availability(
            client,
            venue,
            admin_token_tenant_a,
            # 2026-04-17 is a Friday.
            start=datetime(2026, 4, 17, 0, 0, tzinfo=UTC),
            end=datetime(2026, 4, 18, 12, 0, tzinfo=UTC),
        )

        assert status_code == 200, data
        assert len(data["open_ranges"]) == 1
        got = data["open_ranges"][0]
        assert datetime.fromisoformat(got["start"]) == datetime(
            2026, 4, 17, 22, 0, tzinfo=UTC
        )
        assert datetime.fromisoformat(got["end"]) == datetime(
            2026, 4, 18, 2, 0, tzinfo=UTC
        )

    def test_closed_exception_appears_as_busy(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a, tz="UTC")
        venue = _make_venue(db, tenant_a, popup)
        _add_weekly(db, venue, 0, open_t=time(9), close_t=time(17))

        exc_start = datetime(2026, 4, 13, 12, 0, tzinfo=UTC)
        exc_end = datetime(2026, 4, 13, 14, 0, tzinfo=UTC)
        db.add(
            VenueExceptions(
                tenant_id=tenant_a.id,
                venue_id=venue.id,
                start_datetime=exc_start,
                end_datetime=exc_end,
                is_closed=True,
                reason="Maintenance",
            )
        )
        db.commit()

        status_code, data = _get_availability(
            client,
            venue,
            admin_token_tenant_a,
            start=datetime(2026, 4, 13, 0, 0, tzinfo=UTC),
            end=datetime(2026, 4, 14, 0, 0, tzinfo=UTC),
        )

        assert status_code == 200, data
        assert len(data["busy"]) == 1
        busy = data["busy"][0]
        assert busy["source"] == "exception"
        assert busy["label"] == "Maintenance"
        assert datetime.fromisoformat(busy["start"]) == exc_start
        assert datetime.fromisoformat(busy["end"]) == exc_end

    def test_open_exception_on_day_without_weekly_hours(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Open exception adds a window even when weekly_hours has no entry."""
        popup = _make_popup(db, tenant_a, tz="UTC")
        venue = _make_venue(db, tenant_a, popup)
        # No weekly_hours set.

        exc_start = datetime(2026, 4, 13, 10, 0, tzinfo=UTC)
        exc_end = datetime(2026, 4, 13, 14, 0, tzinfo=UTC)
        db.add(
            VenueExceptions(
                tenant_id=tenant_a.id,
                venue_id=venue.id,
                start_datetime=exc_start,
                end_datetime=exc_end,
                is_closed=False,
                reason="Special opening",
            )
        )
        db.commit()

        status_code, data = _get_availability(
            client,
            venue,
            admin_token_tenant_a,
            start=datetime(2026, 4, 13, 0, 0, tzinfo=UTC),
            end=datetime(2026, 4, 14, 0, 0, tzinfo=UTC),
        )

        assert status_code == 200, data
        assert data["busy"] == []
        assert len(data["open_ranges"]) == 1
        got = data["open_ranges"][0]
        assert datetime.fromisoformat(got["start"]) == exc_start
        assert datetime.fromisoformat(got["end"]) == exc_end

    def test_no_hours_configured_defaults_to_always_open(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Venue with zero weekly_hours and no open exceptions → open 24/7
        across the query window. Closed exceptions still carve out busy."""
        popup = _make_popup(db, tenant_a, tz="UTC")
        venue = _make_venue(db, tenant_a, popup)

        exc_start = datetime(2026, 4, 13, 12, 0, tzinfo=UTC)
        exc_end = datetime(2026, 4, 13, 14, 0, tzinfo=UTC)
        db.add(
            VenueExceptions(
                tenant_id=tenant_a.id,
                venue_id=venue.id,
                start_datetime=exc_start,
                end_datetime=exc_end,
                is_closed=True,
                reason="Deep clean",
            )
        )
        db.commit()

        range_start = datetime(2026, 4, 13, 0, 0, tzinfo=UTC)
        range_end = datetime(2026, 4, 14, 0, 0, tzinfo=UTC)
        status_code, data = _get_availability(
            client,
            venue,
            admin_token_tenant_a,
            start=range_start,
            end=range_end,
        )

        assert status_code == 200, data
        assert len(data["open_ranges"]) == 1
        got = data["open_ranges"][0]
        assert datetime.fromisoformat(got["start"]) == range_start
        assert datetime.fromisoformat(got["end"]) == range_end
        # Closed exception still lands in busy so UIs can render it.
        assert len(data["busy"]) == 1
        assert data["busy"][0]["source"] == "exception"

    def test_event_busy_includes_setup_and_teardown(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a, tz="UTC")
        venue = _make_venue(db, tenant_a, popup, setup_minutes=30, teardown_minutes=15)
        _add_weekly(db, venue, 0, open_t=time(9), close_t=time(17))

        ev_start = datetime(2026, 4, 13, 12, 0, tzinfo=UTC)
        ev_end = datetime(2026, 4, 13, 13, 0, tzinfo=UTC)
        db.add(
            Events(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                venue_id=venue.id,
                owner_id=uuid.uuid4(),
                title="Busy Event",
                start_time=ev_start,
                end_time=ev_end,
                timezone="UTC",
                visibility=EventVisibility.PUBLIC,
                status=EventStatus.PUBLISHED,
            )
        )
        db.commit()

        status_code, data = _get_availability(
            client,
            venue,
            admin_token_tenant_a,
            start=datetime(2026, 4, 13, 0, 0, tzinfo=UTC),
            end=datetime(2026, 4, 14, 0, 0, tzinfo=UTC),
        )

        assert status_code == 200, data
        assert len(data["busy"]) == 1
        busy = data["busy"][0]
        assert busy["source"] == "event"
        assert busy["label"] == "Busy Event"
        assert datetime.fromisoformat(busy["start"]) == ev_start - timedelta(minutes=30)
        assert datetime.fromisoformat(busy["end"]) == ev_end + timedelta(minutes=15)

    def test_cancelled_event_excluded_from_busy(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a, tz="UTC")
        venue = _make_venue(db, tenant_a, popup)
        _add_weekly(db, venue, 0, open_t=time(9), close_t=time(17))

        db.add(
            Events(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                venue_id=venue.id,
                owner_id=uuid.uuid4(),
                title="Cancelled",
                start_time=datetime(2026, 4, 13, 12, 0, tzinfo=UTC),
                end_time=datetime(2026, 4, 13, 13, 0, tzinfo=UTC),
                timezone="UTC",
                visibility=EventVisibility.PUBLIC,
                status=EventStatus.CANCELLED,
            )
        )
        db.commit()

        status_code, data = _get_availability(
            client,
            venue,
            admin_token_tenant_a,
            start=datetime(2026, 4, 13, 0, 0, tzinfo=UTC),
            end=datetime(2026, 4, 14, 0, 0, tzinfo=UTC),
        )

        assert status_code == 200, data
        assert data["busy"] == []

    def test_end_not_after_start_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a, tz="UTC")
        venue = _make_venue(db, tenant_a, popup)

        status_code, _data = _get_availability(
            client,
            venue,
            admin_token_tenant_a,
            start=datetime(2026, 4, 14, 0, 0, tzinfo=UTC),
            end=datetime(2026, 4, 13, 0, 0, tzinfo=UTC),
        )

        assert status_code == 400
