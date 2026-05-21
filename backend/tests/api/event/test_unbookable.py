"""Regression tests for the ``unbookable`` venue booking-mode gate.

``booking_mode = "unbookable"`` is a *portal-facing* restriction. The
backoffice POST/PATCH endpoints pass ``allow_unbookable=True`` down to
the availability helpers so admins can still schedule events on these
venues (e.g. an off-limits room used for an internal staff meeting),
while the portal endpoints keep the default ``False`` and continue to
return 409 ("Venue is not bookable at the selected time").

These tests guard:

1. Admin POST succeeds on an unbookable venue.
2. Admin PATCH succeeds when moving an existing event onto one.
3. Portal POST is still rejected with the existing 409.
4. The admin bypass is scoped to UNBOOKABLE — open-hours and conflict
   gates still apply on the admin path.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, time, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.event_settings.schemas import PublishPermission
from app.api.event_venue.models import EventVenues, VenueWeeklyHours
from app.api.event_venue.schemas import VenueBookingMode, VenueStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers (mirrors the local-helper pattern used by test_event_timezone.py)
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants, *, tz: str = "UTC") -> Popups:
    popup = Popups(
        name=f"Unbookable Test {uuid.uuid4().hex[:6]}",
        slug=f"unbookable-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.flush()
    db.add(
        EventSettings(
            tenant_id=tenant.id,
            popup_id=popup.id,
            timezone=tz,
            event_enabled=True,
            can_publish_event=PublishPermission.EVERYONE,
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
    booking_mode: VenueBookingMode = VenueBookingMode.UNBOOKABLE,
) -> EventVenues:
    venue = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title="Unbookable Test Venue",
        setup_time_minutes=0,
        teardown_time_minutes=0,
        status=VenueStatus.ACTIVE,
        booking_mode=booking_mode,
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


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"unbookable-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Unbookable",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _human_token(human: Humans) -> str:
    from app.core.security import create_access_token

    return create_access_token(subject=human.id, token_type="human")


def _payload(popup: Popups, venue: EventVenues, *, start: str, end: str) -> dict:
    return {
        "popup_id": str(popup.id),
        "venue_id": str(venue.id),
        "title": "Unbookable Test Event",
        "start_time": start,
        "end_time": end,
        "timezone": "UTC",
    }


# ---------------------------------------------------------------------------
# 1. Admin create / update bypass UNBOOKABLE
# ---------------------------------------------------------------------------


class TestAdminBypassesUnbookable:
    def test_admin_can_create_event_in_unbookable_venue(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)
        # No weekly_hours configured → venue is always-open, so the only
        # gate left for this admin POST is the UNBOOKABLE check itself.

        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json=_payload(
                popup,
                venue,
                start="2026-06-04T13:00:00+00:00",
                end="2026-06-04T14:00:00+00:00",
            ),
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["venue_id"] == str(venue.id)

    def test_admin_can_update_event_to_unbookable_venue(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        # Source venue: bookable, so the initial POST succeeds without
        # relying on the bypass — isolating this test to the PATCH path.
        bookable_venue = _make_venue(
            db, tenant_a, popup, booking_mode=VenueBookingMode.FREE
        )
        unbookable_venue = _make_venue(db, tenant_a, popup)

        create_resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json=_payload(
                popup,
                bookable_venue,
                start="2026-06-05T13:00:00+00:00",
                end="2026-06-05T14:00:00+00:00",
            ),
        )
        assert create_resp.status_code == 201, create_resp.text
        event_id = create_resp.json()["id"]

        patch_resp = client.patch(
            f"/api/v1/events/{event_id}",
            headers=_auth(admin_token_tenant_a),
            json={"venue_id": str(unbookable_venue.id)},
        )

        assert patch_resp.status_code == 200, patch_resp.text
        assert patch_resp.json()["venue_id"] == str(unbookable_venue.id)


# ---------------------------------------------------------------------------
# 1b. Admin check-availability endpoints don't 4xx on UNBOOKABLE
# ---------------------------------------------------------------------------


class TestAdminCheckAvailabilityBypassesUnbookable:
    """The AvailabilityIndicator on the backoffice form posts to these two
    endpoints — they must not report UNBOOKABLE as unavailable, otherwise
    the form blocks before submit even though POST /events succeeds."""

    def test_admin_check_availability_returns_available_for_unbookable_venue(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)

        resp = client.post(
            "/api/v1/events/check-availability",
            headers=_auth(admin_token_tenant_a),
            json={
                "venue_id": str(venue.id),
                "start_time": "2026-06-09T13:00:00+00:00",
                "end_time": "2026-06-09T14:00:00+00:00",
            },
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["available"] is True
        # The mode is still surfaced for the UI even though it doesn't block.
        assert body["effective_booking_mode"] == "unbookable"

    def test_admin_check_recurring_availability_unbookable_venue(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)

        resp = client.post(
            "/api/v1/events/check-recurring-availability",
            headers=_auth(admin_token_tenant_a),
            json={
                "venue_id": str(venue.id),
                "start_time": "2026-06-09T13:00:00+00:00",
                "end_time": "2026-06-09T14:00:00+00:00",
                "timezone": "UTC",
            },
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["available"] is True
        assert body["conflicts"] == []


# ---------------------------------------------------------------------------
# 2. Portal still gated by UNBOOKABLE (regression guard on the flag default)
# ---------------------------------------------------------------------------


class TestPortalStillGatedByUnbookable:
    def test_portal_human_cannot_create_event_in_unbookable_venue(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        token = _human_token(human)

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_auth(token),
            json=_payload(
                popup,
                venue,
                start="2026-06-06T13:00:00+00:00",
                end="2026-06-06T14:00:00+00:00",
            ),
        )

        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"] == "Venue is not bookable at the selected time"

    def test_portal_check_availability_still_reports_unbookable(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """The portal-facing check-availability keeps the default flag and
        must still surface ``available=False`` so the portal form blocks
        before submit."""
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        token = _human_token(human)

        resp = client.post(
            "/api/v1/events/portal/events/check-availability",
            headers=_auth(token),
            json={
                "venue_id": str(venue.id),
                "start_time": "2026-06-06T13:00:00+00:00",
                "end_time": "2026-06-06T14:00:00+00:00",
            },
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["available"] is False
        assert body["reason"] == "Venue is not bookable at the selected time"


# ---------------------------------------------------------------------------
# 3. Admin bypass is scoped to UNBOOKABLE — other gates still apply
# ---------------------------------------------------------------------------


class TestAdminStillBlockedByOtherGates:
    def test_admin_create_event_still_blocked_by_existing_booking(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """An overlapping booking on an unbookable venue must still 409 —
        the admin bypass is *only* for the UNBOOKABLE check itself."""
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)

        existing_start = datetime(2026, 6, 7, 13, 0, tzinfo=UTC)
        existing_end = datetime(2026, 6, 7, 14, 0, tzinfo=UTC)
        db.add(
            Events(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                venue_id=venue.id,
                owner_id=uuid.uuid4(),
                title="Existing Admin Booking",
                start_time=existing_start,
                end_time=existing_end,
                timezone="UTC",
                visibility=EventVisibility.PUBLIC,
                status=EventStatus.PUBLISHED,
            )
        )
        db.commit()

        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json=_payload(
                popup,
                venue,
                start=existing_start.isoformat(),
                end=existing_end.isoformat(),
            ),
        )

        assert resp.status_code == 409, resp.text
        assert "Venue already booked" in resp.json()["detail"]

    def test_admin_create_event_still_blocked_by_open_hours(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Out-of-hours slot on an unbookable venue must still be rejected."""
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)
        # 2026-06-08 is a Monday (dow=0). Open 09:00-17:00 UTC; 22:00 is
        # outside — the open-hours gate must fire even on an unbookable
        # venue.
        _add_weekly(db, venue, 0, open_t=time(9), close_t=time(17))

        out_of_hours_start = datetime(2026, 6, 8, 22, 0, tzinfo=UTC)
        out_of_hours_end = out_of_hours_start + timedelta(hours=1)

        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json=_payload(
                popup,
                venue,
                start=out_of_hours_start.isoformat(),
                end=out_of_hours_end.isoformat(),
            ),
        )

        assert resp.status_code >= 400 and resp.status_code < 500, resp.text
        assert resp.status_code != 201
