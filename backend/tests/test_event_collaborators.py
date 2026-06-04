"""Tests for event collaborators.

A collaborator is a human listed in ``events.collaborator_ids``. Collaborators
carry the SAME manage rights as the owner / host (edit / cancel / invitations),
and any collaborator may add or remove other collaborators. Covers:

- Portal create persists ``collaborator_ids`` and the response resolves them to
  slim human profiles (id + name + avatar).
- A collaborator (neither owner nor host) can edit the event via the portal.
- A human who is neither owner, host, nor collaborator gets 403.
- Any collaborator can add another collaborator, who then gains edit rights.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

PORTAL_EVENTS = "/api/v1/events/portal/events"


def _human_auth(human: Humans) -> dict[str, str]:
    return {
        "Authorization": (
            f"Bearer {create_access_token(subject=human.id, token_type='human')}"
        )
    }


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Collab {uuid.uuid4().hex[:6]}",
        slug=f"collab-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants, *, first: str = "Test") -> Humans:
    h = Humans(
        tenant_id=tenant.id,
        email=f"collab-{uuid.uuid4().hex[:8]}@test.com",
        first_name=first,
        last_name="Human",
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def _create_payload(popup: Popups, *, collaborator_ids: list[uuid.UUID]) -> dict:
    return {
        "popup_id": str(popup.id),
        "title": "Collab Event",
        "start_time": "2026-05-05T14:00:00+00:00",
        "end_time": "2026-05-05T15:00:00+00:00",
        "timezone": "UTC",
        "visibility": "public",
        "status": "published",
        "collaborator_ids": [str(c) for c in collaborator_ids],
    }


class TestCollaboratorsCreate:
    def test_create_persists_and_resolves_collaborators(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a, first="Owner")
        collab = _make_human(db, tenant_a, first="Collab")

        resp = client.post(
            PORTAL_EVENTS,
            headers=_human_auth(owner),
            json=_create_payload(popup, collaborator_ids=[collab.id]),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["collaborator_ids"] == [str(collab.id)]
        # Resolved chip carries the human's name for the edit form.
        assert len(body["collaborators"]) == 1
        assert body["collaborators"][0]["id"] == str(collab.id)
        assert body["collaborators"][0]["first_name"] == "Collab"


class TestCollaboratorsPermissions:
    def test_collaborator_can_edit(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a, first="Owner")
        collab = _make_human(db, tenant_a, first="Collab")

        created = client.post(
            PORTAL_EVENTS,
            headers=_human_auth(owner),
            json=_create_payload(popup, collaborator_ids=[collab.id]),
        ).json()

        resp = client.patch(
            f"{PORTAL_EVENTS}/{created['id']}",
            headers=_human_auth(collab),
            json={"title": "Edited by collaborator"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["title"] == "Edited by collaborator"

    def test_non_collaborator_cannot_edit(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a, first="Owner")
        collab = _make_human(db, tenant_a, first="Collab")
        stranger = _make_human(db, tenant_a, first="Stranger")

        created = client.post(
            PORTAL_EVENTS,
            headers=_human_auth(owner),
            json=_create_payload(popup, collaborator_ids=[collab.id]),
        ).json()

        resp = client.patch(
            f"{PORTAL_EVENTS}/{created['id']}",
            headers=_human_auth(stranger),
            json={"title": "Nope"},
        )
        assert resp.status_code == 403, resp.text

    def test_any_collaborator_can_add_another(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a, first="Owner")
        collab = _make_human(db, tenant_a, first="Collab")
        newcomer = _make_human(db, tenant_a, first="Newcomer")

        created = client.post(
            PORTAL_EVENTS,
            headers=_human_auth(owner),
            json=_create_payload(popup, collaborator_ids=[collab.id]),
        ).json()

        # The existing collaborator (not the owner) extends the list.
        resp = client.patch(
            f"{PORTAL_EVENTS}/{created['id']}",
            headers=_human_auth(collab),
            json={"collaborator_ids": [str(collab.id), str(newcomer.id)]},
        )
        assert resp.status_code == 200, resp.text
        assert set(resp.json()["collaborator_ids"]) == {
            str(collab.id),
            str(newcomer.id),
        }

        # The freshly-added collaborator can now edit too.
        resp = client.patch(
            f"{PORTAL_EVENTS}/{created['id']}",
            headers=_human_auth(newcomer),
            json={"title": "Edited by newcomer"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["title"] == "Edited by newcomer"
