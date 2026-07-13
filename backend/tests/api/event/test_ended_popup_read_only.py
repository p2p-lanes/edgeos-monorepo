"""HTTP integration tests for the ended-popup read-only guard.

Popups with status ``ended`` (recap mode) must reject every portal-side
mutation with 403 via ``ensure_popup_writable``, while the same calls keep
working on active popups. Backoffice/admin endpoints are not gated and are
not covered here.
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus
from app.api.event_settings.models import EventSettings
from app.api.event_settings.schemas import PublishPermission
from app.api.event_venue.models import EventVenues
from app.api.event_venue.schemas import VenueBookingMode, VenueStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

READ_ONLY_DETAIL = "This popup has ended and is read-only."

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(
    db: Session, tenant: Tenants, *, suffix: str, status: str = "ended"
) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Ended RO Popup {suffix} {uuid.uuid4().hex[:6]}",
        slug=f"ended-ro-{suffix}-{uuid.uuid4().hex[:6]}",
        status=status,
    )
    db.add(popup)
    db.flush()
    db.add(
        EventSettings(
            tenant_id=tenant.id,
            popup_id=popup.id,
            event_enabled=True,
            can_publish_event=PublishPermission.EVERYONE,
            humans_can_create_venues=True,
            events_require_approval=False,
        )
    )
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"ended-ro-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_event(db: Session, tenant: Tenants, popup: Popups, owner: Humans) -> Events:
    start = datetime(2999, 1, 1, 13, 0, tzinfo=UTC)
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=owner.id,
        title=f"Ended RO Event {uuid.uuid4().hex[:6]}",
        start_time=start,
        end_time=start + timedelta(hours=1),
        custom_location_name="Test Hall",
        custom_location_url="https://maps.test/hall",
        status=EventStatus.PUBLISHED,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _make_venue(
    db: Session, tenant: Tenants, popup: Popups, owner: Humans
) -> EventVenues:
    venue = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=owner.id,
        title=f"Ended RO Venue {uuid.uuid4().hex[:6]}",
        status=VenueStatus.ACTIVE,
        booking_mode=VenueBookingMode.FREE,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


def _auth(human: Humans) -> dict[str, str]:
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def _event_payload(popup: Popups) -> dict:
    return {
        "popup_id": str(popup.id),
        "title": f"Ended RO Create {uuid.uuid4().hex[:6]}",
        "start_time": "2999-01-02T13:00:00+00:00",
        "end_time": "2999-01-02T14:00:00+00:00",
        "timezone": "UTC",
        "custom_location_name": "Test Hall",
        "custom_location_url": "https://maps.test/hall",
    }


# ---------------------------------------------------------------------------
# Tests: portal mutations blocked on ended popups
# ---------------------------------------------------------------------------


class TestEndedPopupPortalWritesBlocked:
    def test_event_create_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="event-create")
        human = _make_human(db, tenant_a, suffix="event-create")

        response = client.post(
            "/api/v1/events/portal/events",
            headers=_auth(human),
            json=_event_payload(popup),
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_event_update_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="event-update")
        human = _make_human(db, tenant_a, suffix="event-update")
        event = _make_event(db, tenant_a, popup, human)

        response = client.patch(
            f"/api/v1/events/portal/events/{event.id}",
            headers=_auth(human),
            json={"title": "New title"},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_event_cancel_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="event-cancel")
        human = _make_human(db, tenant_a, suffix="event-cancel")
        event = _make_event(db, tenant_a, popup, human)

        response = client.post(
            f"/api/v1/events/portal/events/{event.id}/cancel",
            headers=_auth(human),
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_rsvp_register_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="rsvp")
        owner = _make_human(db, tenant_a, suffix="rsvp-owner")
        attendee = _make_human(db, tenant_a, suffix="rsvp-attendee")
        event = _make_event(db, tenant_a, popup, owner)

        response = client.post(
            f"/api/v1/event-participants/portal/register/{event.id}",
            headers=_auth(attendee),
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_check_in_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="check-in")
        owner = _make_human(db, tenant_a, suffix="check-in-owner")
        attendee = _make_human(db, tenant_a, suffix="check-in-attendee")
        event = _make_event(db, tenant_a, popup, owner)

        response = client.post(
            f"/api/v1/event-participants/portal/check-in/{event.id}",
            headers=_auth(attendee),
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_venue_create_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="venue-create")
        human = _make_human(db, tenant_a, suffix="venue-create")

        response = client.post(
            "/api/v1/event-venues/portal/venues",
            headers=_auth(human),
            json={"popup_id": str(popup.id), "title": "Ended RO Venue"},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_bulk_invite_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="bulk-invite")
        owner = _make_human(db, tenant_a, suffix="bulk-invite-owner")
        invitee = _make_human(db, tenant_a, suffix="bulk-invite-invitee")
        event = _make_event(db, tenant_a, popup, owner)

        response = client.post(
            f"/api/v1/events/portal/events/{event.id}/invitations",
            headers=_auth(owner),
            json={"emails": [invitee.email]},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_invitation_delete_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="invitation-delete")
        owner = _make_human(db, tenant_a, suffix="invitation-delete-owner")
        event = _make_event(db, tenant_a, popup, owner)

        # The guard fires after the owner check but before the invitation
        # lookup, so a nonexistent invitation id still hits the 403.
        response = client.delete(
            f"/api/v1/events/portal/events/{event.id}/invitations/{uuid.uuid4()}",
            headers=_auth(owner),
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_venue_update_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="venue-update")
        human = _make_human(db, tenant_a, suffix="venue-update")
        venue = _make_venue(db, tenant_a, popup, human)

        response = client.patch(
            f"/api/v1/event-venues/portal/venues/{venue.id}",
            headers=_auth(human),
            json={"title": "New venue title"},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_venue_delete_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="venue-delete")
        human = _make_human(db, tenant_a, suffix="venue-delete")
        venue = _make_venue(db, tenant_a, popup, human)

        response = client.delete(
            f"/api/v1/event-venues/portal/venues/{venue.id}",
            headers=_auth(human),
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_cancel_registration_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="cancel-reg")
        owner = _make_human(db, tenant_a, suffix="cancel-reg-owner")
        attendee = _make_human(db, tenant_a, suffix="cancel-reg-attendee")
        event = _make_event(db, tenant_a, popup, owner)

        # The guard fires right after the event lookup and before the
        # registration lookup, so no participant row is needed.
        response = client.post(
            f"/api/v1/event-participants/portal/cancel-registration/{event.id}",
            headers=_auth(attendee),
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL


# ---------------------------------------------------------------------------
# Tests: same calls stay writable on active popups
# ---------------------------------------------------------------------------


class TestActivePopupPortalWritesAllowed:
    def test_event_create_succeeds_on_active_popup(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="active-create", status="active")
        human = _make_human(db, tenant_a, suffix="active-create")

        response = client.post(
            "/api/v1/events/portal/events",
            headers=_auth(human),
            json=_event_payload(popup),
        )

        assert response.status_code == 201, response.text
        assert response.json()["popup_id"] == str(popup.id)
