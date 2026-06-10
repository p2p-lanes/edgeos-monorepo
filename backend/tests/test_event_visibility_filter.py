"""Tests for the backoffice "filter events by visibility" feature.

Covers ``GET /api/v1/events?visibility=...`` narrowing the list to a single
visibility (public | unlisted | private). The backend CRUD already supported
visibility filtering; these tests pin the endpoint param wired through to it.

Events are created via the portal endpoint (human auth) so each carries the
creator's chosen visibility — the same path used in production.
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
        name=f"VisFilter {uuid.uuid4().hex[:6]}",
        slug=f"vis-filter-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    h = Humans(
        tenant_id=tenant.id,
        email=f"vis-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Vis",
        last_name="Host",
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def _create_portal_event(
    client: TestClient,
    popup: Popups,
    human: Humans,
    *,
    title: str,
    visibility: str,
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
            "visibility": visibility,
            "status": "published",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


class TestVisibilityFilter:
    def test_visibility_filter_returns_only_matching_events(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        host = _make_human(db, tenant_a)

        pub = _create_portal_event(
            client, popup, host, title="Pub", visibility="public"
        )
        unl = _create_portal_event(
            client, popup, host, title="Unl", visibility="unlisted"
        )
        priv = _create_portal_event(
            client, popup, host, title="Priv", visibility="private"
        )

        for value, expected in (
            ("public", {pub}),
            ("unlisted", {unl}),
            ("private", {priv}),
        ):
            resp = client.get(
                "/api/v1/events",
                params={"popup_id": str(popup.id), "visibility": value},
                headers=_auth(admin_token_tenant_a),
            )
            assert resp.status_code == 200, resp.text
            payload = resp.json()
            ids = {item["id"] for item in payload["results"]}
            assert ids == expected, value
            assert payload["paging"]["total"] == 1
            assert all(
                item["visibility"] == value for item in payload["results"]
            )

    def test_no_visibility_returns_all(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        host = _make_human(db, tenant_a)
        _create_portal_event(client, popup, host, title="Pub", visibility="public")
        _create_portal_event(
            client, popup, host, title="Unl", visibility="unlisted"
        )
        _create_portal_event(
            client, popup, host, title="Priv", visibility="private"
        )

        resp = client.get(
            "/api/v1/events",
            params={"popup_id": str(popup.id)},
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["paging"]["total"] == 3
