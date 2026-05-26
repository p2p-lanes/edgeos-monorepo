from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.api_key import crud as api_key_crud
from app.api.api_key.models import ApiKeys
from app.api.event.models import EventInvitations, Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.event_settings.schemas import PublishPermission
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants

# POST /api/v1/events/portal/events is temporarily disabled for API keys
# (see ``_PAT_ROUTE_POLICIES`` in ``app/core/security.py``). When the route
# is restored, remove this marker from the affected tests.
_post_events_disabled = pytest.mark.skip(
    reason="POST /events disabled for API keys until week 2 of Edge City rollout",
)


def _pat_auth(raw_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw_key}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"PAT Test {uuid.uuid4().hex[:6]}",
        slug=f"pat-{uuid.uuid4().hex[:10]}",
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
    event_enabled: bool = True,
    can_publish_event: PublishPermission = PublishPermission.EVERYONE,
    events_require_approval: bool = True,
) -> EventSettings:
    existing = db.exec(
        select(EventSettings).where(EventSettings.popup_id == popup.id)
    ).first()
    if existing:
        db.delete(existing)
        db.commit()

    row = EventSettings(
        tenant_id=tenant.id,
        popup_id=popup.id,
        event_enabled=event_enabled,
        can_publish_event=can_publish_event,
        events_require_approval=events_require_approval,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"pat-{uuid.uuid4().hex[:8]}@test.com",
        first_name="PAT",
        last_name="Human",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_pat(
    db: Session,
    tenant: Tenants,
    human: Humans,
    *,
    scopes: list[str] | None = None,
) -> str:
    _row, raw = api_key_crud.create_for_human(
        db,
        tenant_id=tenant.id,
        human_id=human.id,
        name="test pat",
        expires_at=None,
        scopes=scopes or ["events:read"],
    )
    return raw


def _event_payload(popup: Popups) -> dict[str, str]:
    start = datetime.now(UTC) + timedelta(days=10)
    end = start + timedelta(hours=1)
    return {
        "popup_id": str(popup.id),
        "title": "PAT Event",
        "start_time": start.isoformat(),
        "end_time": end.isoformat(),
        "timezone": "UTC",
        "visibility": EventVisibility.PUBLIC.value,
        "status": EventStatus.PUBLISHED.value,
    }


class TestApiKeyPolicy:
    def test_pat_can_access_allowed_event_route(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        human = _make_human(db, tenant_a)
        raw_key = _make_pat(db, tenant_a, human, scopes=["events:read"])

        resp = client.get(
            "/api/v1/events/portal/events",
            headers=_pat_auth(raw_key),
        )

        assert resp.status_code == 200, resp.text

    def test_pat_cannot_access_non_event_routes(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        human = _make_human(db, tenant_a)
        raw_key = _make_pat(db, tenant_a, human, scopes=["events:read"])

        resp = client.get(
            "/api/v1/applications/my/applications",
            headers=_pat_auth(raw_key),
        )

        assert resp.status_code == 403, resp.text
        assert "restricted to approved event automation routes" in resp.json()["detail"]

    @_post_events_disabled
    def test_pat_event_respects_event_settings_approval(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(db, tenant_a, popup, events_require_approval=True)
        human = _make_human(db, tenant_a)
        raw_key = _make_pat(
            db,
            tenant_a,
            human,
            scopes=["events:read", "events:write"],
        )

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_pat_auth(raw_key),
            json=_event_payload(popup),
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == EventStatus.PENDING_APPROVAL.value
        assert body["visibility"] == EventVisibility.UNLISTED.value

        db.expire_all()
        row = db.get(Events, uuid.UUID(body["id"]))
        assert row is not None
        assert row.status == EventStatus.PENDING_APPROVAL
        assert row.visibility == EventVisibility.UNLISTED

    @_post_events_disabled
    def test_pat_event_does_not_require_approval_when_settings_disabled(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(db, tenant_a, popup, events_require_approval=False)
        human = _make_human(db, tenant_a)
        raw_key = _make_pat(
            db,
            tenant_a,
            human,
            scopes=["events:read", "events:write"],
        )

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_pat_auth(raw_key),
            json=_event_payload(popup),
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == EventStatus.PUBLISHED.value
        assert body["visibility"] == EventVisibility.PUBLIC.value

        db.expire_all()
        row = db.get(Events, uuid.UUID(body["id"]))
        assert row is not None
        assert row.status == EventStatus.PUBLISHED
        assert row.visibility == EventVisibility.PUBLIC

    @_post_events_disabled
    def test_pat_without_write_scope_cannot_create_event(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        raw_key = _make_pat(db, tenant_a, human, scopes=["events:read"])

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_pat_auth(raw_key),
            json=_event_payload(popup),
        )

        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"] == "API key lacks required scope: events:write"

    def test_pat_with_rsvp_scope_can_register(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=uuid.uuid4(),
            title="Scoped RSVP Event",
            start_time=datetime.now(UTC) + timedelta(days=2),
            end_time=datetime.now(UTC) + timedelta(days=2, hours=1),
            timezone="UTC",
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.PUBLISHED,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        human = _make_human(db, tenant_a)
        raw_key = _make_pat(db, tenant_a, human, scopes=["rsvp:write"])

        resp = client.post(
            f"/api/v1/event-participants/portal/register/{event.id}",
            headers=_pat_auth(raw_key),
        )

        assert resp.status_code == 200, resp.text

    def test_red_flag_human_cannot_create_api_key(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        from app.core.security import create_access_token

        human = _make_human(db, tenant_a)
        human.red_flag = True
        db.add(human)
        db.commit()
        db.refresh(human)

        token = create_access_token(subject=human.id, token_type="human")
        resp = client.post(
            "/api/v1/api-keys",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "blocked", "scopes": ["events:read"]},
        )

        assert resp.status_code == 403, resp.text
        assert (
            resp.json()["detail"] == "Blocked humans cannot create or manage API keys."
        )

    def test_write_scope_api_key_defaults_expiry_when_omitted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        from app.api.api_key.schemas import MAX_WRITE_SCOPE_LIFETIME_DAYS
        from app.core.security import create_access_token

        human = _make_human(db, tenant_a)
        token = create_access_token(subject=human.id, token_type="human")

        resp = client.post(
            "/api/v1/api-keys",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "writer", "scopes": ["events:read", "events:write"]},
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["expires_at"] is not None
        # Server-owned lifetime: roughly ``now + MAX_WRITE_SCOPE_LIFETIME_DAYS``,
        # with a small skew tolerance for the round-trip.
        expires_at = datetime.fromisoformat(body["expires_at"])
        expected = datetime.now(UTC) + timedelta(days=MAX_WRITE_SCOPE_LIFETIME_DAYS)
        assert abs((expires_at - expected).total_seconds()) < 60

    def test_write_scope_api_key_rejects_long_expiry(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        from app.api.api_key.schemas import MAX_WRITE_SCOPE_LIFETIME_DAYS
        from app.core.security import create_access_token

        human = _make_human(db, tenant_a)
        token = create_access_token(subject=human.id, token_type="human")
        # Just past the policy max — the field validator must still reject
        # an explicit value beyond the server's lifetime ceiling.
        expires_at = (
            datetime.now(UTC) + timedelta(days=MAX_WRITE_SCOPE_LIFETIME_DAYS + 10)
        ).isoformat()

        resp = client.post(
            "/api/v1/api-keys",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name": "writer",
                "scopes": ["events:read", "events:write"],
                "expires_at": expires_at,
            },
        )

        assert resp.status_code == 422, resp.text

    def test_admin_can_revoke_all_api_keys_for_human(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        raw_key = _make_pat(db, tenant_a, human, scopes=["events:read"])

        resp = client.post(
            f"/api/v1/humans/{human.id}/api-keys/revoke",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )

        assert resp.status_code == 204, resp.text

        db.expire_all()
        rows = list(db.exec(select(ApiKeys).where(ApiKeys.human_id == human.id)).all())
        assert rows
        assert all(row.revoked_at is not None for row in rows)

        denied = client.get(
            "/api/v1/events/portal/events",
            headers=_pat_auth(raw_key),
        )
        assert denied.status_code == 401, denied.text

    def test_admin_can_list_human_api_keys(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        _make_pat(db, tenant_a, human, scopes=["events:read"])
        _make_pat(
            db,
            tenant_a,
            human,
            scopes=["events:read", "rsvp:write"],
        )

        resp = client.get(
            f"/api/v1/humans/{human.id}/api-keys",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body) == 2
        assert all("key" not in row for row in body)

    def test_pat_can_patch_own_event(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(db, tenant_a, popup, events_require_approval=False)
        human = _make_human(db, tenant_a)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=human.id,
            title="Before",
            start_time=datetime.now(UTC) + timedelta(days=3),
            end_time=datetime.now(UTC) + timedelta(days=3, hours=1),
            timezone="UTC",
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.PUBLISHED,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        raw_key = _make_pat(
            db,
            tenant_a,
            human,
            scopes=["events:read", "events:write"],
        )

        resp = client.patch(
            f"/api/v1/events/portal/events/{event.id}",
            headers=_pat_auth(raw_key),
            json={"title": "After"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["title"] == "After"

        db.expire_all()
        row = db.get(Events, event.id)
        assert row is not None
        assert row.title == "After"

    def test_pat_cannot_patch_others_event(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        attacker = _make_human(db, tenant_a)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=owner.id,
            title="Owned",
            start_time=datetime.now(UTC) + timedelta(days=3),
            end_time=datetime.now(UTC) + timedelta(days=3, hours=1),
            timezone="UTC",
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.PUBLISHED,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        raw_key = _make_pat(
            db,
            tenant_a,
            attacker,
            scopes=["events:read", "events:write"],
        )

        resp = client.patch(
            f"/api/v1/events/portal/events/{event.id}",
            headers=_pat_auth(raw_key),
            json={"title": "Hijack"},
        )

        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"] == "Only the event owner can edit"

    def test_pat_patch_requires_events_write_scope(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=human.id,
            title="ReadScopeOnly",
            start_time=datetime.now(UTC) + timedelta(days=3),
            end_time=datetime.now(UTC) + timedelta(days=3, hours=1),
            timezone="UTC",
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.PUBLISHED,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        raw_key = _make_pat(db, tenant_a, human, scopes=["events:read"])

        resp = client.patch(
            f"/api/v1/events/portal/events/{event.id}",
            headers=_pat_auth(raw_key),
            json={"title": "Nope"},
        )

        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"] == "API key lacks required scope: events:write"

    def test_pat_can_cancel_own_event(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=human.id,
            title="Cancelable",
            start_time=datetime.now(UTC) + timedelta(days=3),
            end_time=datetime.now(UTC) + timedelta(days=3, hours=1),
            timezone="UTC",
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.PUBLISHED,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        raw_key = _make_pat(
            db,
            tenant_a,
            human,
            scopes=["events:read", "events:write"],
        )

        resp = client.post(
            f"/api/v1/events/portal/events/{event.id}/cancel",
            headers=_pat_auth(raw_key),
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == EventStatus.CANCELLED.value

        db.expire_all()
        row = db.get(Events, event.id)
        assert row is not None
        assert row.status == EventStatus.CANCELLED

    def test_pat_can_bulk_invite(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        invitee = _make_human(db, tenant_a)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=owner.id,
            title="InviteHere",
            start_time=datetime.now(UTC) + timedelta(days=3),
            end_time=datetime.now(UTC) + timedelta(days=3, hours=1),
            timezone="UTC",
            visibility=EventVisibility.UNLISTED,
            status=EventStatus.PUBLISHED,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        raw_key = _make_pat(
            db,
            tenant_a,
            owner,
            scopes=["events:read", "events:write"],
        )

        resp = client.post(
            f"/api/v1/events/portal/events/{event.id}/invitations",
            headers=_pat_auth(raw_key),
            json={"emails": [invitee.email]},
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert len(body["invited"]) == 1
        assert body["invited"][0]["human_id"] == str(invitee.id)

    def test_pat_can_list_invitations(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        invitee = _make_human(db, tenant_a)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=owner.id,
            title="ListInvites",
            start_time=datetime.now(UTC) + timedelta(days=3),
            end_time=datetime.now(UTC) + timedelta(days=3, hours=1),
            timezone="UTC",
            visibility=EventVisibility.UNLISTED,
            status=EventStatus.PUBLISHED,
        )
        db.add(event)
        db.add(
            EventInvitations(
                tenant_id=tenant_a.id,
                event_id=event.id,
                human_id=invitee.id,
                invited_by=owner.id,
            )
        )
        db.commit()
        db.refresh(event)

        raw_key = _make_pat(db, tenant_a, owner, scopes=["events:read"])

        resp = client.get(
            f"/api/v1/events/portal/events/{event.id}/invitations",
            headers=_pat_auth(raw_key),
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body) == 1
        assert body[0]["human_id"] == str(invitee.id)

    def test_pat_can_delete_invitation(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        invitee = _make_human(db, tenant_a)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=owner.id,
            title="DeleteInvite",
            start_time=datetime.now(UTC) + timedelta(days=3),
            end_time=datetime.now(UTC) + timedelta(days=3, hours=1),
            timezone="UTC",
            visibility=EventVisibility.UNLISTED,
            status=EventStatus.PUBLISHED,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        inv = EventInvitations(
            tenant_id=tenant_a.id,
            event_id=event.id,
            human_id=invitee.id,
            invited_by=owner.id,
        )
        db.add(inv)
        db.commit()
        db.refresh(inv)

        raw_key = _make_pat(
            db,
            tenant_a,
            owner,
            scopes=["events:read", "events:write"],
        )

        resp = client.delete(
            f"/api/v1/events/portal/events/{event.id}/invitations/{inv.id}",
            headers=_pat_auth(raw_key),
        )

        assert resp.status_code == 204, resp.text

        inv_id = inv.id
        db.expunge(inv)
        remaining = db.exec(
            select(EventInvitations).where(EventInvitations.id == inv_id)
        ).first()
        assert remaining is None

    def test_pat_invitation_routes_require_ownership(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        attacker = _make_human(db, tenant_a)
        invitee = _make_human(db, tenant_a)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=owner.id,
            title="OwnedInvites",
            start_time=datetime.now(UTC) + timedelta(days=3),
            end_time=datetime.now(UTC) + timedelta(days=3, hours=1),
            timezone="UTC",
            visibility=EventVisibility.UNLISTED,
            status=EventStatus.PUBLISHED,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        inv = EventInvitations(
            tenant_id=tenant_a.id,
            event_id=event.id,
            human_id=invitee.id,
            invited_by=owner.id,
        )
        db.add(inv)
        db.commit()
        db.refresh(inv)

        raw_key = _make_pat(
            db,
            tenant_a,
            attacker,
            scopes=["events:read", "events:write"],
        )

        post_resp = client.post(
            f"/api/v1/events/portal/events/{event.id}/invitations",
            headers=_pat_auth(raw_key),
            json={"emails": [invitee.email]},
        )
        assert post_resp.status_code == 403, post_resp.text
        assert (
            post_resp.json()["detail"] == "Only the event owner can manage invitations"
        )

        del_resp = client.delete(
            f"/api/v1/events/portal/events/{event.id}/invitations/{inv.id}",
            headers=_pat_auth(raw_key),
        )
        assert del_resp.status_code == 403, del_resp.text
        assert (
            del_resp.json()["detail"] == "Only the event owner can manage invitations"
        )

    def test_flagging_human_revokes_existing_api_keys(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        raw_key = _make_pat(db, tenant_a, human, scopes=["events:read"])

        resp = client.patch(
            f"/api/v1/humans/{human.id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"red_flag": True},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["red_flag"] is True

        db.expire_all()
        rows = list(db.exec(select(ApiKeys).where(ApiKeys.human_id == human.id)).all())
        assert rows
        assert all(row.revoked_at is not None for row in rows)

        denied = client.get(
            "/api/v1/events/portal/events",
            headers=_pat_auth(raw_key),
        )
        assert denied.status_code == 401, denied.text
