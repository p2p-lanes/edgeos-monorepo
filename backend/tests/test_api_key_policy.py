from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.api_key import crud as api_key_crud
from app.api.api_key.models import ApiKeys
from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.event_settings.schemas import PublishPermission
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


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

    def test_pat_created_event_forces_manual_approval(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(db, tenant_a, popup)
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

    def test_pat_event_create_rate_limit_returns_429(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        raw_key = _make_pat(
            db,
            tenant_a,
            human,
            scopes=["events:read", "events:write"],
        )

        with patch(
            "app.core.security.pat_event_create_rate_limiter.is_allowed",
            return_value=(False, 0),
        ), patch(
            "app.core.security.pat_event_create_rate_limiter.get_ttl",
            return_value=123,
        ):
            resp = client.post(
                "/api/v1/events/portal/events",
                headers=_pat_auth(raw_key),
                json=_event_payload(popup),
            )

        assert resp.status_code == 429, resp.text
        assert resp.json()["detail"] == "API key event creation limit exceeded."
        assert resp.headers["Retry-After"] == "123"

    def test_pat_event_daily_create_rate_limit_returns_429(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        raw_key = _make_pat(
            db,
            tenant_a,
            human,
            scopes=["events:read", "events:write"],
        )

        with patch(
            "app.core.security.pat_event_create_daily_rate_limiter.is_allowed",
            return_value=(False, 0),
        ), patch(
            "app.core.security.pat_event_create_daily_rate_limiter.get_ttl",
            return_value=456,
        ):
            resp = client.post(
                "/api/v1/events/portal/events",
                headers=_pat_auth(raw_key),
                json=_event_payload(popup),
            )

        assert resp.status_code == 429, resp.text
        assert (
            resp.json()["detail"]
            == "API key daily event creation limit exceeded."
        )
        assert resp.headers["Retry-After"] == "456"

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
        assert resp.json()["detail"] == "Blocked humans cannot create or manage API keys."

    def test_write_scope_api_key_requires_expiry(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        from app.core.security import create_access_token

        human = _make_human(db, tenant_a)
        token = create_access_token(subject=human.id, token_type="human")

        resp = client.post(
          "/api/v1/api-keys",
          headers={"Authorization": f"Bearer {token}"},
          json={"name": "writer", "scopes": ["events:read", "events:write"]},
        )

        assert resp.status_code == 422, resp.text

    def test_write_scope_api_key_rejects_long_expiry(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        from app.core.security import create_access_token

        human = _make_human(db, tenant_a)
        token = create_access_token(subject=human.id, token_type="human")
        expires_at = (datetime.now(UTC) + timedelta(days=45)).isoformat()

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
        rows = list(
            db.exec(select(ApiKeys).where(ApiKeys.human_id == human.id)).all()
        )
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
        rows = list(
            db.exec(select(ApiKeys).where(ApiKeys.human_id == human.id)).all()
        )
        assert rows
        assert all(row.revoked_at is not None for row in rows)

        denied = client.get(
            "/api/v1/events/portal/events",
            headers=_pat_auth(raw_key),
        )
        assert denied.status_code == 401, denied.text
