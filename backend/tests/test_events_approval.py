"""Integration tests for the events approval flow.

Two distinct gates are covered:

Venue creation (portal → event-venues/portal/venues)
- ``humans_can_create_venues=False``  → 403 on portal POST.
- ``humans_can_create_venues=True`` + ``venues_require_approval=True``
  → venue lands in ``PENDING``.
- ``humans_can_create_venues=True`` + ``venues_require_approval=False``
  → venue lands in ``ACTIVE``.
- Portal venue listing hides ``PENDING`` rows.
- Admin PATCH to ``status=active`` moves a pending venue into the portal
  listing.

Event creation / approval (events/portal/events + /approve + /reject)
- ``event_enabled=False`` blocks portal creation.
- ``can_publish_event=admin_only`` blocks portal creation with
  ``status=published``.
- A venue with ``booking_mode=approval_required`` forces
  ``status=PENDING_APPROVAL`` and ``visibility=UNLISTED`` regardless of
  the payload.
- POST /events/{id}/approve promotes the event to PUBLISHED + PUBLIC.
- POST /events/{id}/reject marks the event as REJECTED.
- Both endpoints reject non-pending events with 400.

Email delivery in the approve/reject endpoints is controlled by
``settings.emails_enabled`` (False in the test env) so no mocking needed.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.event_settings.schemas import PublishPermission
from app.api.event_venue.models import EventVenues
from app.api.event_venue.schemas import VenueBookingMode, VenueStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _human_auth(human: Humans) -> dict[str, str]:
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Approval Test {uuid.uuid4().hex[:6]}",
        slug=f"approval-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _set_event_settings(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    humans_can_create_venues: bool = False,
    venues_require_approval: bool = True,
    event_enabled: bool = True,
    can_publish_event: PublishPermission = PublishPermission.EVERYONE,
) -> EventSettings:
    """Upsert popup event settings (ensures a clean known state per test)."""
    existing = db.exec(
        select(EventSettings).where(EventSettings.popup_id == popup.id)
    ).first()
    if existing:
        db.delete(existing)
        db.commit()

    row = EventSettings(
        tenant_id=tenant.id,
        popup_id=popup.id,
        humans_can_create_venues=humans_can_create_venues,
        venues_require_approval=venues_require_approval,
        event_enabled=event_enabled,
        can_publish_event=can_publish_event,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"approval-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Test",
        last_name="Human",
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
    status: VenueStatus = VenueStatus.ACTIVE,
    booking_mode: VenueBookingMode = VenueBookingMode.FREE,
) -> EventVenues:
    venue = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title=f"Approval Venue {uuid.uuid4().hex[:4]}",
        status=status,
        booking_mode=booking_mode,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


def _venue_payload(popup: Popups, *, title: str | None = None) -> dict:
    return {
        "popup_id": str(popup.id),
        "title": title or f"Portal Venue {uuid.uuid4().hex[:4]}",
        "booking_mode": VenueBookingMode.FREE.value,
    }


def _event_payload(
    popup: Popups,
    *,
    venue_id: uuid.UUID | None = None,
    status: EventStatus = EventStatus.DRAFT,
    visibility: EventVisibility = EventVisibility.PUBLIC,
) -> dict:
    # Use a hard-coded future instant so the test doesn't race the clock.
    return {
        "popup_id": str(popup.id),
        "title": "Portal Approval Event",
        "start_time": "2026-05-05T14:00:00+00:00",
        "end_time": "2026-05-05T15:00:00+00:00",
        "timezone": "UTC",
        "visibility": visibility.value,
        "status": status.value,
        **({"venue_id": str(venue_id)} if venue_id else {}),
    }


# ---------------------------------------------------------------------------
# Venue approval flow
# ---------------------------------------------------------------------------


class TestVenueCreationGate:
    """POST /event-venues/portal/venues respects event settings."""

    def test_portal_create_blocked_when_feature_disabled(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(
            db, tenant_a, popup, humans_can_create_venues=False
        )
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/event-venues/portal/venues",
            headers=_human_auth(human),
            json=_venue_payload(popup),
        )

        assert resp.status_code == 403, resp.text

    def test_portal_create_when_approval_required_lands_in_pending(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(
            db,
            tenant_a,
            popup,
            humans_can_create_venues=True,
            venues_require_approval=True,
        )
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/event-venues/portal/venues",
            headers=_human_auth(human),
            json=_venue_payload(popup),
        )

        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == VenueStatus.PENDING.value

    def test_portal_create_without_approval_lands_active(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(
            db,
            tenant_a,
            popup,
            humans_can_create_venues=True,
            venues_require_approval=False,
        )
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/event-venues/portal/venues",
            headers=_human_auth(human),
            json=_venue_payload(popup),
        )

        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == VenueStatus.ACTIVE.value


class TestPortalVenueListHidesPending:
    """GET /event-venues/portal/venues filters out PENDING rows."""

    def test_pending_venue_hidden_then_appears_after_admin_activates(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        pending = _make_venue(db, tenant_a, popup, status=VenueStatus.PENDING)
        active = _make_venue(db, tenant_a, popup, status=VenueStatus.ACTIVE)

        first = client.get(
            "/api/v1/event-venues/portal/venues",
            headers=_human_auth(human),
            params={"popup_id": str(popup.id)},
        )
        assert first.status_code == 200, first.text
        visible_ids = {v["id"] for v in first.json()["results"]}
        assert str(active.id) in visible_ids
        assert str(pending.id) not in visible_ids

        patch = client.patch(
            f"/api/v1/event-venues/{pending.id}",
            headers=_auth(admin_token_tenant_a),
            json={"status": VenueStatus.ACTIVE.value},
        )
        assert patch.status_code == 200, patch.text

        second = client.get(
            "/api/v1/event-venues/portal/venues",
            headers=_human_auth(human),
            params={"popup_id": str(popup.id)},
        )
        assert second.status_code == 200, second.text
        assert str(pending.id) in {v["id"] for v in second.json()["results"]}


# ---------------------------------------------------------------------------
# Event approval flow
# ---------------------------------------------------------------------------


class TestEventCreationGate:
    """POST /events/portal/events respects event settings."""

    def test_portal_create_blocked_when_events_disabled(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(db, tenant_a, popup, event_enabled=False)
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json=_event_payload(popup),
        )

        assert resp.status_code == 403, resp.text

    def test_admin_only_publish_blocks_portal_published_creation(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(
            db, tenant_a, popup, can_publish_event=PublishPermission.ADMIN_ONLY
        )
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json=_event_payload(popup, status=EventStatus.PUBLISHED),
        )

        assert resp.status_code == 403, resp.text

    def test_admin_only_publish_allows_portal_draft(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Restricting publish doesn't block DRAFT submissions."""
        popup = _make_popup(db, tenant_a)
        _set_event_settings(
            db, tenant_a, popup, can_publish_event=PublishPermission.ADMIN_ONLY
        )
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json=_event_payload(popup, status=EventStatus.DRAFT),
        )

        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == EventStatus.DRAFT.value


class TestApprovalRequiredVenue:
    """`booking_mode=approval_required` forces PENDING_APPROVAL + UNLISTED."""

    def test_published_payload_downgraded_to_pending_and_unlisted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(db, tenant_a, popup)
        venue = _make_venue(
            db,
            tenant_a,
            popup,
            status=VenueStatus.ACTIVE,
            booking_mode=VenueBookingMode.APPROVAL_REQUIRED,
        )
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json=_event_payload(
                popup,
                venue_id=venue.id,
                status=EventStatus.PUBLISHED,
                visibility=EventVisibility.PUBLIC,
            ),
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == EventStatus.PENDING_APPROVAL.value
        assert body["visibility"] == EventVisibility.UNLISTED.value


class TestApproveRejectTransitions:
    """POST /events/{id}/approve and /reject on PENDING_APPROVAL events."""

    def _pending_event(
        self,
        db: Session,
        tenant: Tenants,
        popup: Popups,
    ) -> Events:
        event = Events(
            tenant_id=tenant.id,
            popup_id=popup.id,
            owner_id=uuid.uuid4(),
            title="Pending Event",
            start_time="2026-05-05T14:00:00+00:00",
            end_time="2026-05-05T15:00:00+00:00",
            timezone="UTC",
            visibility=EventVisibility.UNLISTED,
            status=EventStatus.PENDING_APPROVAL,
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        return event

    def test_approve_promotes_to_published_and_public(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = self._pending_event(db, tenant_a, popup)

        resp = client.post(
            f"/api/v1/events/{event.id}/approve",
            headers=_auth(admin_token_tenant_a),
            json={"reason": "Looks good"},
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == EventStatus.PUBLISHED.value
        assert body["visibility"] == EventVisibility.PUBLIC.value

    def test_reject_sets_status_to_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = self._pending_event(db, tenant_a, popup)

        resp = client.post(
            f"/api/v1/events/{event.id}/reject",
            headers=_auth(admin_token_tenant_a),
            json={"reason": "Wrong venue"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == EventStatus.REJECTED.value

    def test_approve_on_already_published_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=uuid.uuid4(),
            title="Already Published",
            start_time="2026-05-05T14:00:00+00:00",
            end_time="2026-05-05T15:00:00+00:00",
            timezone="UTC",
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.PUBLISHED,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        resp = client.post(
            f"/api/v1/events/{event.id}/approve",
            headers=_auth(admin_token_tenant_a),
            json={},
        )

        assert resp.status_code == 400, resp.text

    def test_reject_on_already_cancelled_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=uuid.uuid4(),
            title="Cancelled",
            start_time="2026-05-05T14:00:00+00:00",
            end_time="2026-05-05T15:00:00+00:00",
            timezone="UTC",
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.CANCELLED,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        resp = client.post(
            f"/api/v1/events/{event.id}/reject",
            headers=_auth(admin_token_tenant_a),
            json={},
        )

        assert resp.status_code == 400, resp.text
