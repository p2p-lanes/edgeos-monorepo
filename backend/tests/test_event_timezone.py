"""Integration tests covering timezone-correctness across the event API.

These tests are the regression net for four production fixes (A/B/C/D) that
together stopped events from being silently shifted between popup-local
and UTC. They focus on the contracts the frontend depends on:

- A POSTed event preserves the caller's IANA timezone *and* its UTC start.
- ``created_at`` is a real tz-aware UTC moment — not a tz-naive value
  interpreted as the server's local TZ (fix D).
- Venue availability slots align to the popup's wall-clock day across
  timezones (fix C).
- The portal POST never falls back to UTC silently when the caller passes
  a non-UTC timezone (fix A/B).

Patterns mirror ``test_event_crud.py`` and ``test_venue_availability.py``;
helpers are duplicated locally (a few lines each) instead of cross-imported
so the test file stands alone.
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
# Helpers
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    tz: str = "UTC",
    start_date: datetime | None = None,
    end_date: datetime | None = None,
) -> Popups:
    popup = Popups(
        name=f"TZ Test {uuid.uuid4().hex[:6]}",
        slug=f"tz-events-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
        start_date=start_date,
        end_date=end_date,
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
) -> EventVenues:
    venue = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title="TZ Test Venue",
        setup_time_minutes=0,
        teardown_time_minutes=0,
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
    open_t: time,
    close_t: time,
) -> None:
    db.add(
        VenueWeeklyHours(
            tenant_id=venue.tenant_id,
            venue_id=venue.id,
            day_of_week=dow,
            open_time=open_t,
            close_time=close_t,
            is_closed=False,
        )
    )
    db.commit()


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"tz-{uuid.uuid4().hex[:8]}@test.com",
        first_name="TZ",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _human_token(human: Humans) -> str:
    from app.core.security import create_access_token

    return create_access_token(subject=human.id, token_type="human")


# ---------------------------------------------------------------------------
# 1. Round-trip: tz string + UTC start preserved through POST → GET
# ---------------------------------------------------------------------------


class TestEventTimezoneRoundtrip:
    """The original bug: tz dropped or shifted on create/read."""

    def test_create_event_in_la_persists_timezone_and_utc_start(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a, tz="America/Los_Angeles")
        # 13:00–16:00 LA on 2026-06-04 in DST (UTC-7) → 20:00Z–23:00Z.
        start_utc = "2026-06-04T20:00:00Z"
        end_utc = "2026-06-04T23:00:00Z"

        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "LA Lunch",
                "start_time": start_utc,
                "end_time": end_utc,
                "timezone": "America/Los_Angeles",
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["timezone"] == "America/Los_Angeles"

        # Re-fetch via GET to confirm the row round-trips, not just the
        # POST's echo response.
        got = client.get(
            f"/api/v1/events/{body['id']}",
            headers=_auth(admin_token_tenant_a),
        )
        assert got.status_code == 200, got.text
        got_body = got.json()
        assert got_body["timezone"] == "America/Los_Angeles"
        assert datetime.fromisoformat(got_body["start_time"]).astimezone(
            UTC
        ) == datetime(2026, 6, 4, 20, 0, tzinfo=UTC)
        assert datetime.fromisoformat(got_body["end_time"]).astimezone(UTC) == datetime(
            2026, 6, 4, 23, 0, tzinfo=UTC
        )

    def test_create_event_in_tokyo_persists_correctly(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a, tz="Asia/Tokyo")
        # 13:00 Tokyo (UTC+9) on 2026-06-04 → 04:00Z.
        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "Tokyo Lunch",
                "start_time": "2026-06-04T04:00:00Z",
                "end_time": "2026-06-04T06:00:00Z",
                "timezone": "Asia/Tokyo",
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["timezone"] == "Asia/Tokyo"
        assert datetime.fromisoformat(body["start_time"]).astimezone(UTC) == datetime(
            2026, 6, 4, 4, 0, tzinfo=UTC
        )

    def test_event_crossing_utc_midnight_keeps_correct_local_day(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Late-evening LA event lands the next UTC day but the SAME LA day.

        Bug surface: if the API or schema silently re-interpreted
        ``start_time`` against UTC, the stored instant would shift by the
        offset and the wall-clock day would slip.
        """
        from zoneinfo import ZoneInfo

        popup = _make_popup(db, tenant_a, tz="America/Los_Angeles")
        la = ZoneInfo("America/Los_Angeles")
        local_start = datetime(
            2026, 6, 4, 23, 0, tzinfo=la
        )  # 23:00 LA = 06:00Z next day
        local_end = local_start + timedelta(hours=1)

        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "Late Night",
                "start_time": local_start.astimezone(UTC).isoformat(),
                "end_time": local_end.astimezone(UTC).isoformat(),
                "timezone": "America/Los_Angeles",
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        start_utc = datetime.fromisoformat(body["start_time"]).astimezone(UTC)
        # UTC day is the 5th, LA day is the 4th — both invariants must hold.
        assert start_utc.date().isoformat() == "2026-06-05"
        assert start_utc.astimezone(la).date().isoformat() == "2026-06-04"


# ---------------------------------------------------------------------------
# 2. ``created_at`` is tz-aware UTC, not server-local naive (fix D)
# ---------------------------------------------------------------------------


class TestCreatedAtIsTzAware:
    def test_created_at_is_real_utc_not_server_local(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        before = datetime.now(UTC)

        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "Now",
                "start_time": (before + timedelta(days=1)).isoformat(),
                "end_time": (before + timedelta(days=1, hours=1)).isoformat(),
            },
        )
        assert resp.status_code == 201, resp.text
        event_id = uuid.UUID(resp.json()["id"])

        db.expire_all()
        row = db.get(Events, event_id)
        assert row is not None
        # The row must come back tz-aware — pre-fix the column would have
        # been naive (interpreted as server local) and downstream
        # comparisons against tz-aware ``datetime.now(UTC)`` would TypeError
        # or silently drift by the host offset.
        assert row.created_at.tzinfo is not None
        delta = abs((datetime.now(UTC) - row.created_at).total_seconds())
        # 60s window keeps the test stable on slow CI runners while still
        # catching any whole-hour offset bug (US offsets are >= 5 hours).
        assert delta < 60, (
            f"created_at appears offset from real UTC by {delta:.0f}s — "
            "likely a server-local naive timestamp."
        )


# ---------------------------------------------------------------------------
# 3. Venue availability respects the popup's wall-clock day across TZs (fix C)
# ---------------------------------------------------------------------------


class TestVenueAvailabilityCrossTimezone:
    def test_event_in_popup_tz_occupies_venue_window(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """LA popup, 09:00-22:00 LA weekly hours, event 13:00-14:00 LA.

        Querying availability for the LA wall-clock day must yield exactly
        one open range covering the local window and one busy slot for the
        event — both aligned to the LA day, not to UTC.
        """
        from zoneinfo import ZoneInfo

        la = ZoneInfo("America/Los_Angeles")
        popup = _make_popup(db, tenant_a, tz="America/Los_Angeles")
        venue = _make_venue(db, tenant_a, popup)
        # 2026-06-04 is a Thursday in LA (dow=3).
        _add_weekly(db, venue, 3, open_t=time(9), close_t=time(22))

        ev_start_local = datetime(2026, 6, 4, 13, 0, tzinfo=la)
        ev_end_local = datetime(2026, 6, 4, 14, 0, tzinfo=la)
        db.add(
            Events(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                venue_id=venue.id,
                owner_id=uuid.uuid4(),
                title="LA Busy Event",
                start_time=ev_start_local.astimezone(UTC),
                end_time=ev_end_local.astimezone(UTC),
                timezone="America/Los_Angeles",
                visibility=EventVisibility.PUBLIC,
                status=EventStatus.PUBLISHED,
            )
        )
        db.commit()

        # Query the LA day [00:00 LA, 24:00 LA) expressed in UTC.
        day_start_local = datetime(2026, 6, 4, 0, 0, tzinfo=la)
        day_end_local = day_start_local + timedelta(days=1)
        resp = client.get(
            f"/api/v1/event-venues/{venue.id}/availability",
            params={
                "start": day_start_local.astimezone(UTC).isoformat(),
                "end": day_end_local.astimezone(UTC).isoformat(),
            },
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["timezone"] == "America/Los_Angeles"
        assert len(data["open_ranges"]) == 1
        got = data["open_ranges"][0]
        # Open range alignment: 09:00-22:00 LA → 16:00Z-05:00Z next day in DST.
        assert datetime.fromisoformat(got["start"]).astimezone(UTC) == datetime(
            2026, 6, 4, 9, 0, tzinfo=la
        ).astimezone(UTC)
        assert datetime.fromisoformat(got["end"]).astimezone(UTC) == datetime(
            2026, 6, 4, 22, 0, tzinfo=la
        ).astimezone(UTC)
        # Busy slot matches the event's wall-clock window in LA.
        assert len(data["busy"]) == 1
        assert datetime.fromisoformat(data["busy"][0]["start"]).astimezone(
            UTC
        ) == ev_start_local.astimezone(UTC)

    def test_check_availability_detects_conflict_when_creating_in_same_local_window(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Existing 13:00 LA event makes a 13:00 LA candidate unavailable."""
        from zoneinfo import ZoneInfo

        la = ZoneInfo("America/Los_Angeles")
        popup = _make_popup(db, tenant_a, tz="America/Los_Angeles")
        venue = _make_venue(db, tenant_a, popup)
        _add_weekly(db, venue, 3, open_t=time(9), close_t=time(22))

        existing_start = datetime(2026, 6, 4, 13, 0, tzinfo=la).astimezone(UTC)
        existing_end = datetime(2026, 6, 4, 14, 0, tzinfo=la).astimezone(UTC)
        db.add(
            Events(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                venue_id=venue.id,
                owner_id=uuid.uuid4(),
                title="Existing",
                start_time=existing_start,
                end_time=existing_end,
                timezone="America/Los_Angeles",
                visibility=EventVisibility.PUBLIC,
                status=EventStatus.PUBLISHED,
            )
        )
        db.commit()

        resp = client.post(
            "/api/v1/events/check-availability",
            headers=_auth(admin_token_tenant_a),
            json={
                "venue_id": str(venue.id),
                "start_time": existing_start.isoformat(),
                "end_time": existing_end.isoformat(),
            },
        )
        # Endpoint is mounted at /api/v1/events/check-availability (router
        # prefix "/events" + route "/check-availability").
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["available"] is False


# ---------------------------------------------------------------------------
# 4. Portal POST preserves the explicit timezone (fix B)
# ---------------------------------------------------------------------------


class TestPortalCreateEvent:
    def test_portal_post_event_persists_timezone_from_payload(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """The wrapper waits for settings to load, then POSTs with the
        resolved popup timezone. If a regression reintroduced the
        ``timezone || "UTC"`` fallback, the row would store UTC and this
        assertion would fail.
        """
        from zoneinfo import ZoneInfo

        la = ZoneInfo("America/Los_Angeles")
        popup = _make_popup(
            db,
            tenant_a,
            tz="America/Los_Angeles",
            start_date=datetime(2026, 6, 1, tzinfo=UTC),
            end_date=datetime(2026, 6, 30, tzinfo=UTC),
        )
        human = _make_human(db, tenant_a)
        token = _human_token(human)

        start = datetime(2026, 6, 4, 13, 0, tzinfo=la).astimezone(UTC)
        end = datetime(2026, 6, 4, 14, 0, tzinfo=la).astimezone(UTC)

        # Route prefix is /events, route path is /portal/events → full path
        # is /api/v1/events/portal/events.
        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_auth(token),
            json={
                "popup_id": str(popup.id),
                "title": "Portal LA Event",
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
                "timezone": "America/Los_Angeles",
                "visibility": "public",
                "status": "published",
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        # The whole point: tz round-trips through the portal path.
        assert body["timezone"] == "America/Los_Angeles"

        db.expire_all()
        row = db.get(Events, uuid.UUID(body["id"]))
        assert row is not None
        assert row.timezone == "America/Los_Angeles"
        assert row.start_time.astimezone(UTC) == start


# ---------------------------------------------------------------------------
# 5. Naive datetime inputs are rejected (fix E)
#
# Pydantic accepts ISO strings without an offset and parses them as naive,
# which Postgres' TIMESTAMPTZ column would then interpret as server-local
# and silently corrupt. The EventCreate/EventUpdate schemas now reject
# naive inputs with a 422.
# ---------------------------------------------------------------------------


class TestNaiveDatetimeRejected:
    def test_create_event_rejects_naive_start_time(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a, tz="America/Los_Angeles")
        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "Naive Test",
                # No 'Z' and no offset — Pydantic parses this as naive.
                "start_time": "2026-06-04T20:00:00",
                "end_time": "2026-06-04T23:00:00Z",
                "timezone": "America/Los_Angeles",
                "visibility": "public",
                "status": "published",
            },
        )
        assert resp.status_code == 422, resp.text
        detail = resp.json()["detail"]
        # The validator's message should mention "timezone offset".
        assert any("timezone offset" in str(err.get("msg", "")) for err in detail), (
            detail
        )

    def test_update_event_rejects_naive_end_time(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        from zoneinfo import ZoneInfo

        la = ZoneInfo("America/Los_Angeles")
        popup = _make_popup(db, tenant_a, tz="America/Los_Angeles")
        start = datetime(2026, 6, 4, 13, 0, tzinfo=la).astimezone(UTC)
        end = datetime(2026, 6, 4, 14, 0, tzinfo=la).astimezone(UTC)

        create_resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "Update Naive Test",
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
                "timezone": "America/Los_Angeles",
                "visibility": "public",
                "status": "published",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        event_id = create_resp.json()["id"]

        patch_resp = client.patch(
            f"/api/v1/events/{event_id}",
            headers=_auth(admin_token_tenant_a),
            json={"end_time": "2026-06-04T15:00:00"},
        )
        assert patch_resp.status_code == 422, patch_resp.text

    def test_offset_input_normalized_to_utc(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Non-UTC offset is accepted and normalized — round-trips as UTC."""
        popup = _make_popup(db, tenant_a, tz="America/Los_Angeles")
        # 13:00-07:00 == 20:00Z. Sent with explicit LA offset, not 'Z'.
        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "Offset Test",
                "start_time": "2026-06-04T13:00:00-07:00",
                "end_time": "2026-06-04T14:00:00-07:00",
                "timezone": "America/Los_Angeles",
                "visibility": "public",
                "status": "published",
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        # Backend serializes UTC instants with '+00:00' or 'Z'.
        assert body["start_time"].startswith("2026-06-04T20:00:00")
