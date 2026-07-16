"""Tests for the custom-location feature on events.

Covers:
- Schema-level XOR validation (venue vs custom location, partial pairs).
- Create flow: persistence, popup-level approval gate still fires, venue
  approval gate skipped.
- Update flow: switching directions clears the dropped side, custom-only
  changes bump ``ical_sequence``.
- ICS rendering for custom-location events.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import (
    EventCreate,
    EventStatus,
    EventUpdate,
    EventVisibility,
)
from app.api.event_settings.models import EventSettings
from app.api.event_venue.models import EventVenues
from app.api.event_venue.schemas import VenueBookingMode, VenueStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from app.services.ical import build_event_ics

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _human_auth(human: Humans) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {create_access_token(subject=human.id, token_type='human')}"
    }


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"CustomLoc {uuid.uuid4().hex[:6]}",
        slug=f"customloc-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    h = Humans(
        tenant_id=tenant.id,
        email=f"customloc-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Test",
        last_name="Human",
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def _make_venue(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    booking_mode: VenueBookingMode = VenueBookingMode.FREE,
) -> EventVenues:
    v = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title=f"Venue {uuid.uuid4().hex[:4]}",
        status=VenueStatus.ACTIVE,
        booking_mode=booking_mode,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


def _set_settings(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    events_require_approval: bool = False,
) -> EventSettings:
    from sqlmodel import select

    existing = db.exec(
        select(EventSettings).where(EventSettings.popup_id == popup.id)
    ).first()
    if existing:
        db.delete(existing)
        db.commit()
    row = EventSettings(
        tenant_id=tenant.id,
        popup_id=popup.id,
        events_require_approval=events_require_approval,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _payload(
    popup: Popups,
    *,
    venue_id: uuid.UUID | None = None,
    custom_location_name: str | None = None,
    custom_location_url: str | None = None,
    status: EventStatus = EventStatus.PUBLISHED,
    visibility: EventVisibility = EventVisibility.PUBLIC,
    max_participant: int | None = None,
) -> dict:
    body: dict = {
        "popup_id": str(popup.id),
        "title": "Custom Location Event",
        "start_time": "2026-05-05T14:00:00+00:00",
        "end_time": "2026-05-05T15:00:00+00:00",
        "timezone": "UTC",
        "visibility": visibility.value,
        "status": status.value,
    }
    if venue_id is not None:
        body["venue_id"] = str(venue_id)
    if custom_location_name is not None:
        body["custom_location_name"] = custom_location_name
    if custom_location_url is not None:
        body["custom_location_url"] = custom_location_url
    if max_participant is not None:
        body["max_participant"] = max_participant
    return body


# ---------------------------------------------------------------------------
# Schema-level validation
# ---------------------------------------------------------------------------


class TestSchemaXOR:
    def test_create_rejects_both_venue_and_custom(self) -> None:
        with pytest.raises(ValueError):
            EventCreate(
                popup_id=uuid.uuid4(),
                title="x",
                start_time=datetime(2026, 5, 5, 14, tzinfo=UTC),
                end_time=datetime(2026, 5, 5, 15, tzinfo=UTC),
                venue_id=uuid.uuid4(),
                custom_location_name="My place",
                custom_location_url="https://maps.google.com/?q=x",
            )

    def test_create_rejects_partial_custom(self) -> None:
        with pytest.raises(ValueError):
            EventCreate(
                popup_id=uuid.uuid4(),
                title="x",
                start_time=datetime(2026, 5, 5, 14, tzinfo=UTC),
                end_time=datetime(2026, 5, 5, 15, tzinfo=UTC),
                custom_location_name="My place",
            )
        with pytest.raises(ValueError):
            EventCreate(
                popup_id=uuid.uuid4(),
                title="x",
                start_time=datetime(2026, 5, 5, 14, tzinfo=UTC),
                end_time=datetime(2026, 5, 5, 15, tzinfo=UTC),
                custom_location_url="https://maps.google.com/?q=x",
            )

    def test_create_allows_neither(self) -> None:
        EventCreate(
            popup_id=uuid.uuid4(),
            title="x",
            start_time=datetime(2026, 5, 5, 14, tzinfo=UTC),
            end_time=datetime(2026, 5, 5, 15, tzinfo=UTC),
        )

    def test_update_partial_unrelated_patch_ignored(self) -> None:
        # A patch that doesn't touch venue/custom must not raise.
        EventUpdate(title="renamed")

    def test_update_rejects_partial_custom(self) -> None:
        with pytest.raises(ValueError):
            EventUpdate(custom_location_name="just the name")


# ---------------------------------------------------------------------------
# Create flow (HTTP)
# ---------------------------------------------------------------------------


class TestCreateCustomLocation:
    def test_create_event_with_custom_location_persists_fields(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json=_payload(
                popup,
                custom_location_name="Mi casa",
                custom_location_url="https://maps.app.goo.gl/abc",
                status=EventStatus.PUBLISHED,
            ),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["custom_location_name"] == "Mi casa"
        assert body["custom_location_url"] == "https://maps.app.goo.gl/abc"
        assert body["venue_id"] is None
        # Status not auto-forced (no popup approval flag, no venue approval).
        assert body["status"] == EventStatus.PUBLISHED.value

    def test_create_event_rejects_both_venue_and_custom_location(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)
        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json=_payload(
                popup,
                venue_id=venue.id,
                custom_location_name="Mi casa",
                custom_location_url="https://maps.app.goo.gl/abc",
            ),
        )
        assert resp.status_code == 422, resp.text

    def test_create_event_rejects_partial_custom_location(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        # Name-only.
        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json=_payload(popup, custom_location_name="Mi casa"),
        )
        assert resp.status_code == 422, resp.text
        # URL-only.
        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json=_payload(popup, custom_location_url="https://maps.app.goo.gl/abc"),
        )
        assert resp.status_code == 422, resp.text

    def test_create_portal_event_with_popup_approval_required(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_settings(db, tenant_a, popup, events_require_approval=True)
        human = _make_human(db, tenant_a)
        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json=_payload(
                popup,
                custom_location_name="Mi casa",
                custom_location_url="https://maps.app.goo.gl/abc",
                status=EventStatus.PUBLISHED,
            ),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == EventStatus.PENDING_APPROVAL.value
        # Visibility the creator chose (default public) is preserved through
        # the pending state; the status gate keeps it out of the public feed.
        assert body["visibility"] == EventVisibility.PUBLIC.value
        assert body["custom_location_name"] == "Mi casa"

    def test_create_portal_event_with_custom_location_skips_venue_approval_gate(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_settings(db, tenant_a, popup, events_require_approval=False)
        # An approval-required venue exists in the popup, but this event uses
        # a custom location and should bypass it.
        _make_venue(
            db, tenant_a, popup, booking_mode=VenueBookingMode.APPROVAL_REQUIRED
        )
        human = _make_human(db, tenant_a)
        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json=_payload(
                popup,
                custom_location_name="Mi casa",
                custom_location_url="https://maps.app.goo.gl/abc",
                status=EventStatus.PUBLISHED,
            ),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == EventStatus.PUBLISHED.value
        assert body["visibility"] == EventVisibility.PUBLIC.value


# ---------------------------------------------------------------------------
# Update flow (HTTP)
# ---------------------------------------------------------------------------


class TestUpdateTransitions:
    def test_switching_venue_to_custom_clears_venue_id(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)
        create = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json=_payload(popup, venue_id=venue.id, status=EventStatus.PUBLISHED),
        )
        assert create.status_code == 201, create.text
        event_id = create.json()["id"]

        patch = client.patch(
            f"/api/v1/events/{event_id}",
            headers=_auth(admin_token_tenant_a),
            json={
                "custom_location_name": "Mi casa",
                "custom_location_url": "https://maps.app.goo.gl/abc",
            },
        )
        assert patch.status_code == 200, patch.text
        body = patch.json()
        assert body["venue_id"] is None
        assert body["custom_location_name"] == "Mi casa"
        assert body["custom_location_url"] == "https://maps.app.goo.gl/abc"

    def test_switching_custom_to_venue_clears_custom_fields(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup)
        create = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json=_payload(
                popup,
                custom_location_name="Mi casa",
                custom_location_url="https://maps.app.goo.gl/abc",
                status=EventStatus.PUBLISHED,
            ),
        )
        assert create.status_code == 201, create.text
        event_id = create.json()["id"]

        patch = client.patch(
            f"/api/v1/events/{event_id}",
            headers=_auth(admin_token_tenant_a),
            json={"venue_id": str(venue.id)},
        )
        assert patch.status_code == 200, patch.text
        body = patch.json()
        assert body["venue_id"] == str(venue.id)
        assert body["custom_location_name"] is None
        assert body["custom_location_url"] is None

    def test_changing_custom_location_bumps_ical_sequence(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        create = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json=_payload(
                popup,
                custom_location_name="Mi casa",
                custom_location_url="https://maps.app.goo.gl/abc",
                status=EventStatus.PUBLISHED,
            ),
        )
        assert create.status_code == 201, create.text
        event_id = create.json()["id"]
        before_seq = create.json()["ical_sequence"]

        # Patch only the custom location name; nothing else changes.
        send_mock = AsyncMock()
        with patch("app.services.event_itip.send_event_itip", new=send_mock):
            patch_resp = client.patch(
                f"/api/v1/events/{event_id}",
                headers=_auth(admin_token_tenant_a),
                json={
                    "custom_location_name": "Mi nueva casa",
                    "custom_location_url": "https://maps.app.goo.gl/xyz",
                },
            )
        assert patch_resp.status_code == 200, patch_resp.text
        body = patch_resp.json()
        assert body["ical_sequence"] == before_seq + 1


# ---------------------------------------------------------------------------
# ICS rendering
# ---------------------------------------------------------------------------


class TestIcsRendering:
    def test_ics_export_uses_custom_location_for_LOCATION_field(self) -> None:
        start = datetime(2026, 5, 5, 14, tzinfo=UTC)
        event = Events(
            tenant_id=uuid.uuid4(),
            popup_id=uuid.uuid4(),
            owner_id=uuid.uuid4(),
            title="My Off-site Event",
            start_time=start,
            end_time=start + timedelta(hours=1),
            timezone="UTC",
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.PUBLISHED,
            custom_location_name="Mi casa",
            custom_location_url="https://maps.app.goo.gl/abc",
        )

        ics = build_event_ics(event, recipient_email="alice@example.com")

        assert "LOCATION:Mi casa — https://maps.app.goo.gl/abc" in ics


class TestPortalLocationRequired:
    """Portal events must have a venue or a custom location.

    Online-only (meeting) events can no longer be created or converted to
    via the portal; pre-existing meetings stay editable. Admin endpoints
    remain unrestricted (legacy data management).
    """

    def test_portal_create_without_location_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_settings(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json=_payload(popup),
        )
        assert resp.status_code == 422, resp.text
        assert "venue or a custom location" in resp.json()["detail"]

    def test_portal_create_with_venue_ok(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_settings(db, tenant_a, popup)
        venue = _make_venue(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json=_payload(popup, venue_id=venue.id),
        )
        assert resp.status_code == 201, resp.text

    def test_portal_update_cannot_strip_location(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_settings(db, tenant_a, popup)
        venue = _make_venue(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        create = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json=_payload(popup, venue_id=venue.id),
        )
        assert create.status_code == 201, create.text
        event_id = create.json()["id"]

        patch = client.patch(
            f"/api/v1/events/portal/events/{event_id}",
            headers=_human_auth(human),
            json={
                "venue_id": None,
                "custom_location_name": None,
                "custom_location_url": None,
                "meeting_url": "https://meet.google.com/abc",
            },
        )
        assert patch.status_code == 422, patch.text
        assert "venue or a custom location" in patch.json()["detail"]

    def test_portal_update_legacy_meeting_event_still_editable(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_settings(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        # Seed a legacy online-only event directly (portal can't create one).
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=human.id,
            title="Legacy Meeting",
            start_time=datetime(2026, 5, 5, 14, tzinfo=UTC),
            end_time=datetime(2026, 5, 5, 15, tzinfo=UTC),
            timezone="UTC",
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.PUBLISHED,
            meeting_url="https://meet.google.com/abc",
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        # The edit form always sends the full location triplet; a meeting
        # event keeps venue/custom null — that must stay allowed.
        patch = client.patch(
            f"/api/v1/events/portal/events/{event.id}",
            headers=_human_auth(human),
            json={
                "title": "Legacy Meeting (renamed)",
                "venue_id": None,
                "custom_location_name": None,
                "custom_location_url": None,
                "meeting_url": "https://meet.google.com/abc",
            },
        )
        assert patch.status_code == 200, patch.text
        assert patch.json()["title"] == "Legacy Meeting (renamed)"
