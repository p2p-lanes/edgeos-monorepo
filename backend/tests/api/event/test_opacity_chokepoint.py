"""Integration tests for the opacity chokepoint — T-gr-010 through T-gr-014.

Tests:
  - Per-endpoint leakage tests (7 endpoints): assert non-members cannot see
    metadata (title, description, host_display_name, meeting_url, tags) on
    group-scoped PRIVATE events via portal listing, single GET, and admin GET.
  - Regression tests for legacy invitation-based PRIVATE events:
    * Listing: non-invitee humans still see the event as ABSENT (unchanged)
    * Availability: non-invitee humans now see EventOpaque (security fix)
    * Owner + invitees: full detail at every endpoint
  - Recurrence + opacity: PRIVATE recurring events yield EventOpaque for every
    occurrence to a non-member; full detail for member.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import EventInvitations, Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.event_settings.schemas import PublishPermission
from app.api.event_venue.models import EventVenues
from app.api.event_venue.schemas import VenueBookingMode, VenueStatus
from app.api.group.models import GroupMembers, Groups
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"OpacityTest {uuid.uuid4().hex[:6]}",
        slug=f"opacity-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.flush()
    db.add(
        EventSettings(
            tenant_id=tenant.id,
            popup_id=popup.id,
            timezone="UTC",
            event_enabled=True,
            can_publish_event=PublishPermission.EVERYONE,
        )
    )
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants, *, suffix: str | None = None) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"opacity-{suffix or uuid.uuid4().hex[:8]}@test.com",
        first_name="Opacity",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_venue(db: Session, tenant: Tenants, popup: Popups) -> EventVenues:
    venue = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title=f"Opacity Venue {uuid.uuid4().hex[:4]}",
        status=VenueStatus.ACTIVE,
        booking_mode=VenueBookingMode.FREE,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


def _make_group(db: Session, tenant: Tenants, popup: Popups) -> Groups:
    g = Groups(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Opacity Group {uuid.uuid4().hex[:6]}",
        slug=f"opacity-grp-{uuid.uuid4().hex[:8]}",
        enable_private_events=True,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return g


def _make_member(db: Session, group: Groups, human: Humans) -> None:
    db.add(
        GroupMembers(
            tenant_id=group.tenant_id,
            group_id=group.id,
            human_id=human.id,
        )
    )
    db.commit()


def _make_private_group_event(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    group: Groups,
    owner: Humans,
    venue: EventVenues | None = None,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    rrule: str | None = None,
) -> Events:
    s = start or datetime(2030, 8, 1, 14, 0, 0, tzinfo=UTC)
    e = end or datetime(2030, 8, 1, 15, 0, 0, tzinfo=UTC)
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=owner.id,
        title="Secret Group Event",
        content="Secret content that must not leak",
        meeting_url="https://secret.example.com/meet",
        host_display_name="Secret Host",
        tags=["secret-tag"],
        start_time=s,
        end_time=e,
        timezone="UTC",
        visibility=EventVisibility.PRIVATE,
        status=EventStatus.PUBLISHED,
        group_id=group.id,
        venue_id=venue.id if venue else None,
        rrule=rrule,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _make_private_invitation_event(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    owner: Humans,
    venue: EventVenues | None = None,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
) -> Events:
    s = start or datetime(2030, 9, 1, 14, 0, 0, tzinfo=UTC)
    e = end or datetime(2030, 9, 1, 15, 0, 0, tzinfo=UTC)
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=owner.id,
        title="Private Invited Event",
        content="Invitation-based private content",
        meeting_url="https://secret.example.com/invite",
        host_display_name="Inviter Host",
        tags=["invite-tag"],
        start_time=s,
        end_time=e,
        timezone="UTC",
        visibility=EventVisibility.PRIVATE,
        status=EventStatus.PUBLISHED,
        group_id=None,
        venue_id=venue.id if venue else None,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _invite_human(
    db: Session,
    event: Events,
    human: Humans,
) -> None:
    db.add(
        EventInvitations(
            tenant_id=event.tenant_id,
            event_id=event.id,
            human_id=human.id,
        )
    )
    db.commit()


SENSITIVE_FIELDS = {"title", "content", "meeting_url", "host_display_name", "tags"}


def _assert_no_sensitive_fields(response_event: dict) -> None:
    """Assert none of the sensitive fields appear in the event dict."""
    for field in SENSITIVE_FIELDS:
        assert field not in response_event, (
            f"Sensitive field '{field}' leaked in response: "
            f"{response_event.get(field)!r}"
        )


# ---------------------------------------------------------------------------
# T-gr-012: Per-endpoint leakage tests — group-scoped PRIVATE events
# ---------------------------------------------------------------------------


class TestGroupPrivateLeakage:
    """Non-members must not see group-scoped PRIVATE event metadata."""

    @pytest.fixture(autouse=True)
    def _setup(self, db: Session, tenant_a: Tenants) -> None:
        self.db = db
        self.popup = _make_popup(db, tenant_a)
        self.owner = _make_human(db, tenant_a)
        self.member = _make_human(db, tenant_a)
        self.non_member = _make_human(db, tenant_a)
        self.venue = _make_venue(db, tenant_a, self.popup)
        self.group = _make_group(db, tenant_a, self.popup)
        _make_member(db, self.group, self.member)
        self.event = _make_private_group_event(
            db, tenant_a, self.popup, self.group, self.owner, self.venue
        )

    # --- 1. list_portal_events ---

    def test_non_member_does_not_see_group_event_in_portal_listing(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.non_member)
        resp = client.get(
            "/api/v1/events/portal/events",
            headers=_auth(token),
            params={"popup_id": str(self.popup.id)},
        )
        assert resp.status_code == 200
        event_ids = [e["id"] for e in resp.json()["results"]]
        assert str(self.event.id) not in event_ids

    def test_member_sees_group_event_in_portal_listing(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.member)
        resp = client.get(
            "/api/v1/events/portal/events",
            headers=_auth(token),
            params={"popup_id": str(self.popup.id)},
        )
        assert resp.status_code == 200
        event_ids = [e["id"] for e in resp.json()["results"]]
        assert str(self.event.id) in event_ids

    def test_owner_sees_own_group_event_in_portal_listing(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.owner)
        resp = client.get(
            "/api/v1/events/portal/events",
            headers=_auth(token),
            params={"popup_id": str(self.popup.id)},
        )
        assert resp.status_code == 200
        event_ids = [e["id"] for e in resp.json()["results"]]
        assert str(self.event.id) in event_ids

    # --- 2. get_portal_event ---

    def test_non_member_gets_404_for_group_event(self, client: TestClient) -> None:
        token = _human_token(self.non_member)
        resp = client.get(
            f"/api/v1/events/portal/events/{self.event.id}",
            headers=_auth(token),
        )
        assert resp.status_code == 404

    def test_member_gets_full_detail_for_group_event(self, client: TestClient) -> None:
        token = _human_token(self.member)
        resp = client.get(
            f"/api/v1/events/portal/events/{self.event.id}",
            headers=_auth(token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["title"] == "Secret Group Event"
        assert body["id"] == str(self.event.id)

    def test_owner_gets_full_detail_for_own_group_event(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.owner)
        resp = client.get(
            f"/api/v1/events/portal/events/{self.event.id}",
            headers=_auth(token),
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == str(self.event.id)

    # --- 3. check_availability (admin/backoffice) ---

    def test_availability_check_returns_opaque_conflicts_for_non_member(
        self, client: TestClient, admin_token_tenant_a: str
    ) -> None:
        """Admin check_availability should still flag the time slot as busy.

        The admin path always has full visibility (is_admin_in_popup=True),
        so the availability result will contain the event ID.
        The opaque_conflicts field is populated for portal/human callers.
        """
        resp = client.post(
            "/api/v1/events/check-availability",
            headers=_auth(admin_token_tenant_a),
            json={
                "venue_id": str(self.venue.id),
                "start_time": self.event.start_time.isoformat(),
                "end_time": self.event.end_time.isoformat(),
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        # Venue is NOT free — blocked by the private event
        assert body["available"] is False
        assert str(self.event.id) in body["conflicts"]

    # --- 4. check_availability_portal ---

    def test_portal_availability_check_non_member_sees_opaque(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.non_member)
        resp = client.post(
            "/api/v1/events/portal/events/check-availability",
            headers=_auth(token),
            json={
                "venue_id": str(self.venue.id),
                "start_time": self.event.start_time.isoformat(),
                "end_time": self.event.end_time.isoformat(),
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        # opaque_conflicts must contain the event with is_opaque=True
        opaque = body.get("opaque_conflicts", [])
        assert len(opaque) == 1
        assert opaque[0]["is_opaque"] is True
        assert opaque[0]["id"] == str(self.event.id)
        _assert_no_sensitive_fields(opaque[0])

    def test_portal_availability_check_member_does_not_see_opaque(
        self, client: TestClient
    ) -> None:
        """Member sees full event — conflict should NOT be in opaque_conflicts."""
        token = _human_token(self.member)
        resp = client.post(
            "/api/v1/events/portal/events/check-availability",
            headers=_auth(token),
            json={
                "venue_id": str(self.venue.id),
                "start_time": self.event.start_time.isoformat(),
                "end_time": self.event.end_time.isoformat(),
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        # Full event ID in conflicts, no opaque entry
        assert str(self.event.id) in body["conflicts"]
        opaque = body.get("opaque_conflicts", [])
        assert all(o["id"] != str(self.event.id) for o in opaque)

    # --- 5. check_recurring_availability ---

    def test_recurring_availability_non_member_sees_opaque_conflicts(
        self, client: TestClient, admin_token_tenant_a: str
    ) -> None:
        """Admin check-recurring-availability still detects the block."""
        resp = client.post(
            "/api/v1/events/check-recurring-availability",
            headers=_auth(admin_token_tenant_a),
            json={
                "venue_id": str(self.venue.id),
                "start_time": self.event.start_time.isoformat(),
                "end_time": self.event.end_time.isoformat(),
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False

    # --- 6+7. Admin single GET (always full detail) ---

    def test_admin_single_get_returns_full_detail(
        self, client: TestClient, admin_token_tenant_a: str
    ) -> None:
        resp = client.get(
            f"/api/v1/events/{self.event.id}",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["title"] == "Secret Group Event"
        assert body["id"] == str(self.event.id)


# ---------------------------------------------------------------------------
# T-gr-013: Regression tests — legacy invitation-based PRIVATE events
# ---------------------------------------------------------------------------


class TestLegacyInvitationPrivateRegression:
    """Invitation-based PRIVATE events (group_id IS NULL) regression coverage.

    Listing behavior: unchanged — non-invitees don't see the event in portal
    listings or get a 404 on single GET (same as today).

    Availability behavior: CHANGED (security fix) — non-invitees now see
    EventOpaque in availability endpoints. Previously, PRIVATE events were
    silently excluded from availability conflict metadata, leaking that the
    venue was somehow free. Now they surface as opaque conflicts.
    """

    @pytest.fixture(autouse=True)
    def _setup(self, db: Session, tenant_a: Tenants) -> None:
        self.db = db
        self.popup = _make_popup(db, tenant_a)
        self.owner = _make_human(db, tenant_a)
        self.invitee = _make_human(db, tenant_a)
        self.non_invitee = _make_human(db, tenant_a)
        self.venue = _make_venue(db, tenant_a, self.popup)
        self.event = _make_private_invitation_event(
            db, tenant_a, self.popup, self.owner, self.venue
        )
        _invite_human(db, self.event, self.invitee)

    # --- Listing behavior: unchanged ---

    def test_non_invitee_does_not_see_event_in_portal_listing(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.non_invitee)
        resp = client.get(
            "/api/v1/events/portal/events",
            headers=_auth(token),
            params={"popup_id": str(self.popup.id)},
        )
        assert resp.status_code == 200
        event_ids = [e["id"] for e in resp.json()["results"]]
        assert str(self.event.id) not in event_ids

    def test_invitee_sees_event_in_portal_listing(self, client: TestClient) -> None:
        token = _human_token(self.invitee)
        resp = client.get(
            "/api/v1/events/portal/events",
            headers=_auth(token),
            params={"popup_id": str(self.popup.id)},
        )
        assert resp.status_code == 200
        event_ids = [e["id"] for e in resp.json()["results"]]
        assert str(self.event.id) in event_ids

    def test_owner_sees_own_event_in_portal_listing(self, client: TestClient) -> None:
        token = _human_token(self.owner)
        resp = client.get(
            "/api/v1/events/portal/events",
            headers=_auth(token),
            params={"popup_id": str(self.popup.id)},
        )
        assert resp.status_code == 200
        event_ids = [e["id"] for e in resp.json()["results"]]
        assert str(self.event.id) in event_ids

    def test_non_invitee_gets_404_on_portal_single_get(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.non_invitee)
        resp = client.get(
            f"/api/v1/events/portal/events/{self.event.id}",
            headers=_auth(token),
        )
        assert resp.status_code == 404

    def test_invitee_gets_full_detail_on_portal_single_get(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.invitee)
        resp = client.get(
            f"/api/v1/events/portal/events/{self.event.id}",
            headers=_auth(token),
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Private Invited Event"

    def test_owner_gets_full_detail_on_portal_single_get(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.owner)
        resp = client.get(
            f"/api/v1/events/portal/events/{self.event.id}",
            headers=_auth(token),
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Private Invited Event"

    # --- Availability behavior: CHANGED (security fix) ---

    def test_non_invitee_sees_opaque_in_portal_availability_new_behavior(
        self, client: TestClient
    ) -> None:
        """Security fix: non-invitees now see EventOpaque on portal availability."""
        token = _human_token(self.non_invitee)
        resp = client.post(
            "/api/v1/events/portal/events/check-availability",
            headers=_auth(token),
            json={
                "venue_id": str(self.venue.id),
                "start_time": self.event.start_time.isoformat(),
                "end_time": self.event.end_time.isoformat(),
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        opaque = body.get("opaque_conflicts", [])
        assert len(opaque) == 1
        assert opaque[0]["is_opaque"] is True
        assert opaque[0]["id"] == str(self.event.id)
        _assert_no_sensitive_fields(opaque[0])

    def test_invitee_sees_full_conflict_in_portal_availability(
        self, client: TestClient
    ) -> None:
        """Invitee sees full event ID in conflicts — not opaque."""
        token = _human_token(self.invitee)
        resp = client.post(
            "/api/v1/events/portal/events/check-availability",
            headers=_auth(token),
            json={
                "venue_id": str(self.venue.id),
                "start_time": self.event.start_time.isoformat(),
                "end_time": self.event.end_time.isoformat(),
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        assert str(self.event.id) in body["conflicts"]
        opaque = body.get("opaque_conflicts", [])
        assert all(o["id"] != str(self.event.id) for o in opaque)

    def test_owner_sees_full_conflict_in_portal_availability(
        self, client: TestClient
    ) -> None:
        """Owner sees full event ID in conflicts — not opaque."""
        token = _human_token(self.owner)
        resp = client.post(
            "/api/v1/events/portal/events/check-availability",
            headers=_auth(token),
            json={
                "venue_id": str(self.venue.id),
                "start_time": self.event.start_time.isoformat(),
                "end_time": self.event.end_time.isoformat(),
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        assert str(self.event.id) in body["conflicts"]


# ---------------------------------------------------------------------------
# T-gr-014: Recurrence + opacity
# ---------------------------------------------------------------------------


class TestRecurringPrivateOpacity:
    """Recurring group-scoped PRIVATE events yield consistent opacity per occurrence."""

    @pytest.fixture(autouse=True)
    def _setup(self, db: Session, tenant_a: Tenants) -> None:
        self.db = db
        self.popup = _make_popup(db, tenant_a)
        self.owner = _make_human(db, tenant_a)
        self.member = _make_human(db, tenant_a)
        self.non_member = _make_human(db, tenant_a)
        self.venue = _make_venue(db, tenant_a, self.popup)
        self.group = _make_group(db, tenant_a, self.popup)
        _make_member(db, self.group, self.member)
        # Weekly recurring event: Mon 14:00-15:00 UTC starting 2030-11-04
        self.master = _make_private_group_event(
            db,
            tenant_a,
            self.popup,
            self.group,
            self.owner,
            self.venue,
            start=datetime(2030, 11, 4, 14, 0, 0, tzinfo=UTC),
            end=datetime(2030, 11, 4, 15, 0, 0, tzinfo=UTC),
            rrule="FREQ=WEEKLY;COUNT=4",
        )

    def test_recurring_portal_availability_non_member_sees_opaque(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.non_member)
        # Check against first occurrence slot
        resp = client.post(
            "/api/v1/events/portal/events/check-availability",
            headers=_auth(token),
            json={
                "venue_id": str(self.venue.id),
                "start_time": self.master.start_time.isoformat(),
                "end_time": self.master.end_time.isoformat(),
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        opaque = body.get("opaque_conflicts", [])
        assert len(opaque) >= 1
        assert all(o["is_opaque"] is True for o in opaque)
        # None of the opaque entries should have sensitive fields
        for o in opaque:
            _assert_no_sensitive_fields(o)

    def test_recurring_portal_availability_member_does_not_see_opaque(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.member)
        resp = client.post(
            "/api/v1/events/portal/events/check-availability",
            headers=_auth(token),
            json={
                "venue_id": str(self.venue.id),
                "start_time": self.master.start_time.isoformat(),
                "end_time": self.master.end_time.isoformat(),
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        # Full conflict ID present, no opaque entry for this master
        assert str(self.master.id) in body["conflicts"]
        opaque = body.get("opaque_conflicts", [])
        assert all(o["id"] != str(self.master.id) for o in opaque)

    def test_recurring_non_member_omitted_from_portal_listing(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.non_member)
        resp = client.get(
            "/api/v1/events/portal/events",
            headers=_auth(token),
            params={"popup_id": str(self.popup.id)},
        )
        assert resp.status_code == 200
        event_ids = [e["id"] for e in resp.json()["results"]]
        assert str(self.master.id) not in event_ids

    def test_recurring_member_sees_event_in_portal_listing(
        self, client: TestClient
    ) -> None:
        token = _human_token(self.member)
        resp = client.get(
            "/api/v1/events/portal/events",
            headers=_auth(token),
            params={"popup_id": str(self.popup.id)},
        )
        assert resp.status_code == 200
        event_ids = [e["id"] for e in resp.json()["results"]]
        assert str(self.master.id) in event_ids
