"""Event capacity vs venue capacity.

Covers the auto-cap rules in event create/update:
- Portal create: capacity left unset defaults to the venue's capacity.
- Portal create: explicit capacity within the venue's is kept.
- Portal update: raising capacity above the venue's is clamped (edits have
  no approval gate, unlike creation).
- Portal update: clearing/omitting capacity while switching venue defaults
  to the new venue's capacity.
- Admin create: unset capacity defaults to the venue's; explicit values are
  trusted even above the venue's.
- Venues without a configured capacity leave event capacity untouched.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.event_venue.models import EventVenues
from app.api.event_venue.schemas import VenueBookingMode, VenueStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _human_auth(human: Humans) -> dict[str, str]:
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Capacity Test {uuid.uuid4().hex[:6]}",
        slug=f"capacity-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.flush()
    db.add(
        EventSettings(
            tenant_id=tenant.id,
            popup_id=popup.id,
            event_enabled=True,
            events_require_approval=False,
        )
    )
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"capacity-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Cap",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_venue(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    capacity: int | None,
) -> EventVenues:
    venue = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title=f"Capacity Venue {uuid.uuid4().hex[:4]}",
        status=VenueStatus.ACTIVE,
        booking_mode=VenueBookingMode.FREE,
        capacity=capacity,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


def _event_payload(
    popup: Popups,
    venue: EventVenues | None,
    *,
    max_participant: int | None = None,
    hour: int = 14,
) -> dict:
    body = {
        "popup_id": str(popup.id),
        "title": "Capacity Event",
        "start_time": f"2026-05-05T{hour:02d}:00:00+00:00",
        "end_time": f"2026-05-05T{hour:02d}:45:00+00:00",
        "timezone": "UTC",
        "visibility": EventVisibility.PUBLIC.value,
        "status": EventStatus.PUBLISHED.value,
    }
    if venue is not None:
        body["venue_id"] = str(venue.id)
    if max_participant is not None:
        body["max_participant"] = max_participant
    return body


def _get_event(db: Session, event_id: str) -> Events:
    return db.exec(select(Events).where(Events.id == uuid.UUID(event_id))).one()


class TestPortalCapacityCap:
    def test_create_unset_capacity_defaults_to_venue(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup, capacity=10)
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            json=_event_payload(popup, venue),
            headers=_human_auth(human),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["max_participant"] == 10

    def test_create_explicit_capacity_within_venue_kept(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup, capacity=10)
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            json=_event_payload(popup, venue, max_participant=7),
            headers=_human_auth(human),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["max_participant"] == 7

    def test_create_no_venue_capacity_stays_unset(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup, capacity=None)
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            json=_event_payload(popup, venue),
            headers=_human_auth(human),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["max_participant"] is None

    def test_update_raising_capacity_above_venue_is_clamped(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup, capacity=10)
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            json=_event_payload(popup, venue, max_participant=8),
            headers=_human_auth(human),
        )
        assert resp.status_code == 201, resp.text
        event_id = resp.json()["id"]

        resp = client.patch(
            f"/api/v1/events/portal/events/{event_id}",
            json={"max_participant": 39},
            headers=_human_auth(human),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["max_participant"] == 10
        assert _get_event(db, event_id).max_participant == 10

    def test_update_switching_venue_defaults_capacity(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue_a = _make_venue(db, tenant_a, popup, capacity=None)
        venue_b = _make_venue(db, tenant_a, popup, capacity=12)
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            json=_event_payload(popup, venue_a),
            headers=_human_auth(human),
        )
        assert resp.status_code == 201, resp.text
        event_id = resp.json()["id"]
        assert resp.json()["max_participant"] is None

        resp = client.patch(
            f"/api/v1/events/portal/events/{event_id}",
            # Different hour so the new venue has no conflict.
            json={"venue_id": str(venue_b.id)},
            headers=_human_auth(human),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["max_participant"] == 12


class TestAdminCapacityDefault:
    def test_admin_create_unset_capacity_defaults_to_venue(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup, capacity=15)

        resp = client.post(
            "/api/v1/events",
            json=_event_payload(popup, venue),
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["max_participant"] == 15

    def test_admin_create_explicit_overage_trusted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup, capacity=15)

        resp = client.post(
            "/api/v1/events",
            json=_event_payload(popup, venue, max_participant=40),
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["max_participant"] == 40
