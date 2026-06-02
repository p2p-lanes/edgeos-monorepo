"""Backoffice-created events must resolve a real Human creator.

Admin Users live in a separate table from Humans, so an event created from the
backoffice cannot own itself off ``current_user.id`` (a Users id) — that leaves
the event ownerless ("Unknown" in the UI) and uneditable through the portal,
whose update endpoint gates on ``event.owner_id == current_human.id``.

These tests lock in the fix: ``create_event`` maps the owner to the Human
sharing the admin's email in the tenant (creating one if absent), so the host
can edit the event from the portal.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _human_auth(human: Humans) -> dict[str, str]:
    return {
        "Authorization": (
            f"Bearer {create_access_token(subject=human.id, token_type='human')}"
        )
    }


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"CreatorMap {uuid.uuid4().hex[:6]}",
        slug=f"creatormap-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _payload(popup: Popups) -> dict:
    return {
        "popup_id": str(popup.id),
        "title": "Backoffice Event",
        "start_time": "2026-05-05T14:00:00+00:00",
        "end_time": "2026-05-05T15:00:00+00:00",
        "timezone": "UTC",
        "status": "published",
    }


def test_owner_maps_to_human_with_admin_email(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_user_tenant_a: Users,
    admin_token_tenant_a: str,
) -> None:
    popup = _make_popup(db, tenant_a)

    resp = client.post(
        "/api/v1/events",
        headers=_auth(admin_token_tenant_a),
        json=_payload(popup),
    )
    assert resp.status_code == 201, resp.text
    owner_id = uuid.UUID(resp.json()["owner_id"])

    # The owner is a Human (not the admin User) sharing the admin's email.
    assert owner_id != admin_user_tenant_a.id
    human = db.exec(select(Humans).where(Humans.id == owner_id)).first()
    assert human is not None
    assert human.email == admin_user_tenant_a.email
    assert human.tenant_id == tenant_a.id


def test_reuses_existing_human_instead_of_duplicating(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_user_tenant_a: Users,
    admin_token_tenant_a: str,
) -> None:
    # Two events created by the same admin must share one Human owner — the
    # (email, tenant) Human is reused, never duplicated.
    first = client.post(
        "/api/v1/events",
        headers=_auth(admin_token_tenant_a),
        json=_payload(_make_popup(db, tenant_a)),
    )
    second = client.post(
        "/api/v1/events",
        headers=_auth(admin_token_tenant_a),
        json=_payload(_make_popup(db, tenant_a)),
    )
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["owner_id"] == second.json()["owner_id"]

    matches = db.exec(
        select(Humans).where(
            Humans.email == admin_user_tenant_a.email,
            Humans.tenant_id == tenant_a.id,
        )
    ).all()
    assert len(matches) == 1


def test_backoffice_event_is_editable_by_host_from_portal(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    popup = _make_popup(db, tenant_a)
    resp = client.post(
        "/api/v1/events",
        headers=_auth(admin_token_tenant_a),
        json=_payload(popup),
    )
    assert resp.status_code == 201, resp.text
    event_id = resp.json()["id"]
    owner = db.get(Humans, uuid.UUID(resp.json()["owner_id"]))
    assert owner is not None

    # The mapped Human passes the portal's owner check (no 403) — the exact
    # symptom the fix targets. ``content`` is not an iTIP calendar field, so
    # this patch dispatches no invitation emails.
    patch = client.patch(
        f"/api/v1/events/portal/events/{event_id}",
        headers=_human_auth(owner),
        json={"content": "Edited from the portal"},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["content"] == "Edited from the portal"
