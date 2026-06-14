"""Tests for the backoffice "filter events by creator (host)" feature.

Covers:
- ``GET /api/v1/events?owner_id=...`` narrows the list to a single host.
- ``GET /api/v1/events/hosts`` returns the distinct hosts (Humans referenced
  by ``Events.owner_id``) for a popup, with name + email for the picker.

Events are created via the portal endpoint (human auth) so ``owner_id`` is set
to the creating human — the same path used in production for hosted events.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


def _human_auth(human: Humans) -> dict[str, str]:
    return {
        "Authorization": (
            f"Bearer {create_access_token(subject=human.id, token_type='human')}"
        )
    }


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"CreatorFilter {uuid.uuid4().hex[:6]}",
        slug=f"creator-filter-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(
    db: Session,
    tenant: Tenants,
    *,
    first_name: str | None = None,
    last_name: str | None = None,
) -> Humans:
    h = Humans(
        tenant_id=tenant.id,
        email=f"creator-{uuid.uuid4().hex[:8]}@test.com",
        first_name=first_name,
        last_name=last_name,
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def _create_portal_event(
    client: TestClient, popup: Popups, human: Humans, *, title: str
) -> str:
    resp = client.post(
        "/api/v1/events/portal/events",
        headers=_human_auth(human),
        json={
            "popup_id": str(popup.id),
            "title": title,
            "start_time": "2026-05-05T14:00:00+00:00",
            "end_time": "2026-05-05T15:00:00+00:00",
            "timezone": "UTC",
            "custom_location_name": "Test Spot",
            "custom_location_url": "https://maps.google.com/?q=test",
            "visibility": "public",
            "status": "published",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


class TestOwnerIdFilter:
    def test_owner_id_filter_returns_only_that_hosts_events(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        host_a = _make_human(db, tenant_a, first_name="Ada", last_name="Host")
        host_b = _make_human(db, tenant_a, first_name="Bo", last_name="Host")

        a1 = _create_portal_event(client, popup, host_a, title="A1")
        a2 = _create_portal_event(client, popup, host_a, title="A2")
        _create_portal_event(client, popup, host_b, title="B1")

        resp = client.get(
            "/api/v1/events",
            params={"popup_id": str(popup.id), "owner_id": str(host_a.id)},
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        ids = {item["id"] for item in payload["results"]}
        assert ids == {a1, a2}
        assert payload["paging"]["total"] == 2
        assert all(item["owner_id"] == str(host_a.id) for item in payload["results"])

    def test_no_owner_id_returns_all_hosts_events(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        host_a = _make_human(db, tenant_a, first_name="Ada")
        host_b = _make_human(db, tenant_a, first_name="Bo")
        _create_portal_event(client, popup, host_a, title="A1")
        _create_portal_event(client, popup, host_b, title="B1")

        resp = client.get(
            "/api/v1/events",
            params={"popup_id": str(popup.id)},
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["paging"]["total"] == 2


class TestListEventHosts:
    def test_hosts_endpoint_returns_distinct_hosts_with_name_and_email(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        host_a = _make_human(db, tenant_a, first_name="Ada", last_name="Lovelace")
        host_b = _make_human(db, tenant_a)  # no name → name should be null

        # host_a hosts two events; must still appear once (distinct).
        _create_portal_event(client, popup, host_a, title="A1")
        _create_portal_event(client, popup, host_a, title="A2")
        _create_portal_event(client, popup, host_b, title="B1")

        resp = client.get(
            "/api/v1/events/hosts",
            params={"popup_id": str(popup.id)},
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        hosts = resp.json()
        by_id = {h["id"]: h for h in hosts}

        assert by_id.keys() == {str(host_a.id), str(host_b.id)}
        assert by_id[str(host_a.id)]["name"] == "Ada Lovelace"
        assert by_id[str(host_a.id)]["email"] == host_a.email
        assert by_id[str(host_b.id)]["name"] is None
        assert by_id[str(host_b.id)]["email"] == host_b.email

    def test_hosts_endpoint_excludes_other_popups(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        other_popup = _make_popup(db, tenant_a)
        host = _make_human(db, tenant_a, first_name="Ada")
        _create_portal_event(client, popup, host, title="A1")

        resp = client.get(
            "/api/v1/events/hosts",
            params={"popup_id": str(other_popup.id)},
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == []
