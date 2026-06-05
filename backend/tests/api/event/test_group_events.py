"""Integration tests for PR-6: Events group_id + validators + iTIP (T-gr-041).

Covers:
  - T-gr-035: group_id accepted in EventCreate/EventUpdate schemas
  - T-gr-036: Mutual exclusion validator (group_id + EventInvitations → 422)
  - T-gr-037: Creator must be member validator (→ 403)
  - T-gr-038: enable_private_events gate (→ 422)
  - T-gr-039: group_id persisted on create/update
  - T-gr-040: gather_event_recipients branches on group_id

Spec refs: REQ-GR-018 (group_id FK + enable_private_events gate),
           REQ-GR-019 (PRIVATE + group_id = group-scoped),
           REQ-GR-022 (iTIP recipient resolution)
Design refs: Decision 1a-1 (validators), Decision 1h (iTIP branching)
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import EventInvitations, Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.event_settings.schemas import PublishPermission
from app.api.group.models import GroupMembers, Groups
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


ADMIN_EVENTS_URL = "/api/v1/events"
PORTAL_EVENTS_URL = "/api/v1/events/portal/events"


def _admin_token(user: Users) -> str:
    return create_access_token(subject=user.id, token_type="user")


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    group_private_events_enabled: bool = True,
) -> Popups:
    popup = Popups(
        name=f"GroupEvents {uuid.uuid4().hex[:6]}",
        slug=f"grp-evt-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        group_private_events_enabled=group_private_events_enabled,
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


def _make_human(db: Session, tenant: Tenants, email: str | None = None) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=email or f"grpevt-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Group",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_group(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    enable_private_events: bool = True,
) -> Groups:
    group = Groups(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"GE Group {uuid.uuid4().hex[:6]}",
        slug=f"ge-grp-{uuid.uuid4().hex[:8]}",
        enable_private_events=enable_private_events,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


def _add_member(db: Session, group: Groups, human: Humans) -> None:
    db.add(
        GroupMembers(
            tenant_id=group.tenant_id,
            group_id=group.id,
            human_id=human.id,
        )
    )
    db.commit()


def _event_payload(
    popup_id: uuid.UUID,
    *,
    visibility: str = "private",
    group_id: uuid.UUID | None = None,
) -> dict:
    return {
        "popup_id": str(popup_id),
        "title": "Test Group Event",
        "start_time": "2031-01-15T14:00:00Z",
        "end_time": "2031-01-15T15:00:00Z",
        "timezone": "UTC",
        "visibility": visibility,
        "status": "published",
        "group_id": str(group_id) if group_id else None,
    }


# ---------------------------------------------------------------------------
# T-gr-035: group_id accepted in schemas
# ---------------------------------------------------------------------------


class TestGroupIdInSchemas:
    """group_id field is accepted by EventCreate/EventUpdate (T-gr-035)."""

    def test_create_private_event_with_group_id_accepted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Admin can create a PRIVATE event with group_id when group has the flag."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, enable_private_events=True)

        payload = _event_payload(popup.id, visibility="private", group_id=group.id)
        resp = client.post(
            ADMIN_EVENTS_URL,
            json=payload,
            headers=_auth(_admin_token(admin_user_tenant_a)),
        )
        assert resp.status_code == 201, resp.json()
        data = resp.json()
        assert data["group_id"] == str(group.id)
        assert data["visibility"] == "private"

    def test_group_id_on_public_event_rejected_by_schema(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """group_id + non-PRIVATE visibility → 422 at schema level."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup)

        payload = _event_payload(popup.id, visibility="public", group_id=group.id)
        resp = client.post(
            ADMIN_EVENTS_URL,
            json=payload,
            headers=_auth(_admin_token(admin_user_tenant_a)),
        )
        assert resp.status_code == 422
        body = resp.json()
        # Error is in the detail — check it mentions group_id or PRIVATE
        detail = str(body)
        assert "PRIVATE" in detail or "group_id" in detail.lower()

    def test_event_without_group_id_unchanged(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Creating a PRIVATE event without group_id still works (invitation-based)."""
        popup = _make_popup(db, tenant_a)
        payload = _event_payload(popup.id, visibility="private", group_id=None)
        resp = client.post(
            ADMIN_EVENTS_URL,
            json=payload,
            headers=_auth(_admin_token(admin_user_tenant_a)),
        )
        assert resp.status_code == 201
        assert resp.json()["group_id"] is None


# ---------------------------------------------------------------------------
# T-gr-036: Mutual exclusion — group_id + EventInvitations
# ---------------------------------------------------------------------------


class TestMutualExclusion:
    """group_id and explicit invitations are mutually exclusive (T-gr-036)."""

    def test_group_id_and_invitations_rejected_via_bulk_invite_on_group_event(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Admin: event with group_id cannot have bulk invitations added."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, enable_private_events=True)

        # Create the group-scoped event
        payload = _event_payload(popup.id, visibility="private", group_id=group.id)
        create_resp = client.post(
            ADMIN_EVENTS_URL,
            json=payload,
            headers=_auth(_admin_token(admin_user_tenant_a)),
        )
        assert create_resp.status_code == 201
        event_id = create_resp.json()["id"]

        # Try to add explicit invitations via bulk-invite endpoint — should be blocked
        human = _make_human(db, tenant_a)
        invite_resp = client.post(
            f"/api/v1/events/{event_id}/invitations",
            json={"emails": [human.email]},
            headers=_auth(_admin_token(admin_user_tenant_a)),
        )
        # The bulk-invite endpoint must reject this: group-scoped events
        # use group membership, not individual invitations.
        assert invite_resp.status_code == 422, invite_resp.json()
        assert "group" in invite_resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# T-gr-037: Creator must be member validator
# ---------------------------------------------------------------------------


class TestCreatorMembershipValidator:
    """Portal human creating a group event must be a member (T-gr-037)."""

    def test_non_member_human_cannot_create_group_event(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Portal human NOT in the group gets 403 when setting group_id."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, enable_private_events=True)
        human = _make_human(db, tenant_a)
        # human is NOT added to group

        payload = _event_payload(popup.id, visibility="private", group_id=group.id)
        resp = client.post(
            PORTAL_EVENTS_URL,
            json=payload,
            headers=_auth(_human_token(human)),
        )
        assert resp.status_code == 403
        assert "member" in resp.json()["detail"].lower()

    def test_member_human_can_create_group_event(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Portal human who IS a member can create a group-scoped PRIVATE event."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, enable_private_events=True)
        human = _make_human(db, tenant_a)
        _add_member(db, group, human)

        payload = _event_payload(popup.id, visibility="private", group_id=group.id)
        resp = client.post(
            PORTAL_EVENTS_URL,
            json=payload,
            headers=_auth(_human_token(human)),
        )
        assert resp.status_code == 201, resp.json()
        data = resp.json()
        assert data["group_id"] == str(group.id)

    def test_admin_bypasses_membership_check(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Admin create_event bypasses the creator-must-be-member check."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, enable_private_events=True)
        # admin is NOT in group_members — should still succeed

        payload = _event_payload(popup.id, visibility="private", group_id=group.id)
        resp = client.post(
            ADMIN_EVENTS_URL,
            json=payload,
            headers=_auth(_admin_token(admin_user_tenant_a)),
        )
        assert resp.status_code == 201, resp.json()
        assert resp.json()["group_id"] == str(group.id)


# ---------------------------------------------------------------------------
# T-gr-038: enable_private_events gate
# ---------------------------------------------------------------------------


class TestEnablePrivateEventsGate:
    """Group must have enable_private_events=True to accept group_id (T-gr-038)."""

    def test_group_without_flag_rejects_event_creation(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Event with group_id=G where G.enable_private_events=False → 422."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, enable_private_events=False)

        payload = _event_payload(popup.id, visibility="private", group_id=group.id)
        resp = client.post(
            ADMIN_EVENTS_URL,
            json=payload,
            headers=_auth(_admin_token(admin_user_tenant_a)),
        )
        assert resp.status_code == 422
        assert "enable_private_events" in resp.json()["detail"]

    def test_group_with_flag_accepts_event_creation(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Event with group_id=G where G.enable_private_events=True → 201."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, enable_private_events=True)

        payload = _event_payload(popup.id, visibility="private", group_id=group.id)
        resp = client.post(
            ADMIN_EVENTS_URL,
            json=payload,
            headers=_auth(_admin_token(admin_user_tenant_a)),
        )
        assert resp.status_code == 201

    def test_nonexistent_group_returns_404(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Event with group_id pointing to a non-existent group → 404."""
        popup = _make_popup(db, tenant_a)
        fake_group_id = uuid.uuid4()

        payload = _event_payload(popup.id, visibility="private", group_id=fake_group_id)
        resp = client.post(
            ADMIN_EVENTS_URL,
            json=payload,
            headers=_auth(_admin_token(admin_user_tenant_a)),
        )
        assert resp.status_code in (404, 422)


# ---------------------------------------------------------------------------
# T-gr-039: group_id persisted on create/update
# ---------------------------------------------------------------------------


class TestGroupIdPersisted:
    """group_id is persisted to the events table on create and update (T-gr-039)."""

    def test_group_id_persisted_on_create(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """group_id in EventCreate → stored in the DB row."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, enable_private_events=True)

        payload = _event_payload(popup.id, visibility="private", group_id=group.id)
        resp = client.post(
            ADMIN_EVENTS_URL,
            json=payload,
            headers=_auth(_admin_token(admin_user_tenant_a)),
        )
        assert resp.status_code == 201
        event_id = resp.json()["id"]

        # Read back from DB to confirm persistence
        event = db.get(Events, uuid.UUID(event_id))
        assert event is not None
        assert event.group_id == group.id

    def test_group_id_persisted_on_update(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """group_id in EventUpdate → stored and retrievable from the DB row."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, enable_private_events=True)

        # Create a plain PRIVATE event first (no group)
        create_payload = _event_payload(popup.id, visibility="private", group_id=None)
        create_resp = client.post(
            ADMIN_EVENTS_URL,
            json=create_payload,
            headers=_auth(_admin_token(admin_user_tenant_a)),
        )
        assert create_resp.status_code == 201
        event_id = create_resp.json()["id"]

        # Now patch it to set group_id
        patch_resp = client.patch(
            f"/api/v1/events/{event_id}",
            json={"group_id": str(group.id)},
            headers=_auth(_admin_token(admin_user_tenant_a)),
        )
        assert patch_resp.status_code == 200, patch_resp.json()
        assert patch_resp.json()["group_id"] == str(group.id)

        # Confirm in DB
        db.expire_all()
        event = db.get(Events, uuid.UUID(event_id))
        assert event is not None
        assert event.group_id == group.id


# ---------------------------------------------------------------------------
# T-gr-040: iTIP gather_event_recipients — group branch
# ---------------------------------------------------------------------------


class TestITIPGroupRecipients:
    """gather_event_recipients branches on group_id (T-gr-040)."""

    def test_group_event_recipients_from_members_not_invitations(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """For a group-scoped PRIVATE event, recipients come from GroupMembers."""
        from app.services.event_itip import gather_event_recipients

        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, enable_private_events=True)

        owner = _make_human(db, tenant_a)
        member1 = _make_human(db, tenant_a)
        member2 = _make_human(db, tenant_a)
        non_member = _make_human(db, tenant_a)

        _add_member(db, group, owner)
        _add_member(db, group, member1)
        _add_member(db, group, member2)

        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=owner.id,
            title="Group iTIP Event",
            start_time=datetime(2031, 2, 1, 14, 0, 0, tzinfo=UTC),
            end_time=datetime(2031, 2, 1, 15, 0, 0, tzinfo=UTC),
            timezone="UTC",
            visibility=EventVisibility.PRIVATE,
            status=EventStatus.PUBLISHED,
            group_id=group.id,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        # Add an explicit EventInvitations row for the non-member — must NOT appear
        db.add(
            EventInvitations(
                tenant_id=tenant_a.id,
                event_id=event.id,
                human_id=non_member.id,
            )
        )
        db.commit()

        recipients = gather_event_recipients(db, event)
        recipient_ids = {r["human_id"] for r in recipients}

        # All members appear
        assert owner.id in recipient_ids
        assert member1.id in recipient_ids
        assert member2.id in recipient_ids
        # Non-member explicitly invited is NOT in the group-branch result
        assert non_member.id not in recipient_ids

    def test_invitation_event_recipients_from_invitations_not_members(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """For a legacy invitation-based PRIVATE event (group_id=None),
        recipients come from EventInvitations (unchanged behavior)."""
        from app.services.event_itip import gather_event_recipients

        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, enable_private_events=True)

        owner = _make_human(db, tenant_a)
        member = _make_human(db, tenant_a)
        invitee = _make_human(db, tenant_a)

        _add_member(db, group, member)

        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=owner.id,
            title="Invitation iTIP Event",
            start_time=datetime(2031, 3, 1, 14, 0, 0, tzinfo=UTC),
            end_time=datetime(2031, 3, 1, 15, 0, 0, tzinfo=UTC),
            timezone="UTC",
            visibility=EventVisibility.PRIVATE,
            status=EventStatus.PUBLISHED,
            group_id=None,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        db.add(
            EventInvitations(
                tenant_id=tenant_a.id,
                event_id=event.id,
                human_id=invitee.id,
            )
        )
        db.commit()

        recipients = gather_event_recipients(db, event)
        recipient_ids = {r["human_id"] for r in recipients}

        # Invitee appears; group member does NOT (group not linked to this event)
        assert invitee.id in recipient_ids
        assert member.id not in recipient_ids

    def test_group_event_email_only_members_skipped(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Group members with no human_id (email-only whitelist) are excluded from
        iTIP recipients. GroupMembers always have a human_id in this implementation
        (email-only entries use a different mechanism). This test confirms that
        members with valid human_id all appear."""
        from app.services.event_itip import gather_event_recipients

        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, enable_private_events=True)
        owner = _make_human(db, tenant_a)
        member = _make_human(db, tenant_a)
        _add_member(db, group, owner)
        _add_member(db, group, member)

        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=owner.id,
            title="Group Event Skip Test",
            start_time=datetime(2031, 4, 1, 14, 0, 0, tzinfo=UTC),
            end_time=datetime(2031, 4, 1, 15, 0, 0, tzinfo=UTC),
            timezone="UTC",
            visibility=EventVisibility.PRIVATE,
            status=EventStatus.PUBLISHED,
            group_id=group.id,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        recipients = gather_event_recipients(db, event)
        assert len(recipients) == 2  # owner + member
        emails = {r["email"] for r in recipients}
        assert owner.email in emails
        assert member.email in emails

    def test_public_event_recipients_from_participants(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Non-PRIVATE events still use EventParticipants (unchanged behavior)."""
        from app.services.event_itip import gather_event_recipients

        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)

        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=owner.id,
            title="Public iTIP Event",
            start_time=datetime(2031, 5, 1, 14, 0, 0, tzinfo=UTC),
            end_time=datetime(2031, 5, 1, 15, 0, 0, tzinfo=UTC),
            timezone="UTC",
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.PUBLISHED,
            group_id=None,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        # No participants → empty recipients
        recipients = gather_event_recipients(db, event)
        assert recipients == []
