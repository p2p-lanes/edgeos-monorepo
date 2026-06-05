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

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.track.models import Tracks
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


class TestCollaboratorsListVisibility:
    """Host and collaborators see private/unlisted events in portal listings.

    The owner has always seen their own private/unlisted events; managers
    (host / collaborators) now get the same listing visibility — mirroring
    ``_human_manages_event`` — while a stranger still does not see them.
    """

    def _create(
        self,
        client: TestClient,
        popup: Popups,
        owner: Humans,
        *,
        visibility: str,
        host_id: uuid.UUID | None = None,
        collaborator_ids: list[uuid.UUID] | None = None,
    ) -> str:
        payload = _create_payload(popup, collaborator_ids=collaborator_ids or [])
        payload["visibility"] = visibility
        if host_id is not None:
            payload["host_id"] = str(host_id)
        resp = client.post(PORTAL_EVENTS, headers=_human_auth(owner), json=payload)
        assert resp.status_code == 201, resp.text
        return resp.json()["id"]

    def _list_ids(self, client: TestClient, popup: Popups, human: Humans) -> set[str]:
        resp = client.get(
            PORTAL_EVENTS,
            params={"popup_id": str(popup.id)},
            headers=_human_auth(human),
        )
        assert resp.status_code == 200, resp.text
        return {item["id"] for item in resp.json()["results"]}

    @pytest.mark.parametrize("visibility", ["private", "unlisted"])
    def test_host_and_collaborator_see_restricted_event(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        visibility: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a, first="Owner")
        host = _make_human(db, tenant_a, first="Host")
        collab = _make_human(db, tenant_a, first="Collab")
        stranger = _make_human(db, tenant_a, first="Stranger")

        event_id = self._create(
            client,
            popup,
            owner,
            visibility=visibility,
            host_id=host.id,
            collaborator_ids=[collab.id],
        )

        assert event_id in self._list_ids(client, popup, owner)
        assert event_id in self._list_ids(client, popup, host)
        assert event_id in self._list_ids(client, popup, collab)
        assert event_id not in self._list_ids(client, popup, stranger)


class TestCollaboratorEmailResolution:
    """A nameless collaborator's chip falls back to email in the backoffice.

    The admin (backoffice) endpoints resolve ``email`` so a human with no
    name shows their email instead of a raw id; the portal endpoints leave it
    ``None`` so organizer emails aren't exposed to every viewer.
    """

    def test_admin_resolves_email_portal_does_not(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a, first="Owner")
        # Nameless human: the chip has nothing but the email to fall back to.
        nameless = Humans(
            tenant_id=tenant_a.id,
            email=f"nameless-{uuid.uuid4().hex[:8]}@test.com",
            first_name=None,
            last_name=None,
        )
        db.add(nameless)
        db.commit()
        db.refresh(nameless)

        created = client.post(
            PORTAL_EVENTS,
            headers=_human_auth(owner),
            json=_create_payload(popup, collaborator_ids=[nameless.id]),
        ).json()

        # Admin (backoffice) GET exposes the email for the fallback.
        admin_resp = client.get(
            f"/api/v1/events/{created['id']}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert admin_resp.status_code == 200, admin_resp.text
        collab = admin_resp.json()["collaborators"][0]
        assert collab["id"] == str(nameless.id)
        assert collab["email"] == nameless.email

        # Portal GET must not leak the organizer email.
        portal_resp = client.get(
            f"{PORTAL_EVENTS}/{created['id']}",
            headers=_human_auth(owner),
        )
        assert portal_resp.status_code == 200, portal_resp.text
        assert portal_resp.json()["collaborators"][0]["email"] is None


class TestManagedOnlyListing:
    """``managed_only`` filters the portal listing to events the caller manages.

    Filtering happens in SQL (owner / host / collaborator), so a managed event
    is returned regardless of where it falls in the popup's start-time order —
    the previous front-side filter over a paginated page silently dropped
    managed events that sat past the fetch limit.
    """

    def _post(
        self, client: TestClient, popup: Popups, owner: Humans, payload_extra: dict
    ) -> dict:
        payload = {**_create_payload(popup, collaborator_ids=[]), **payload_extra}
        resp = client.post(PORTAL_EVENTS, headers=_human_auth(owner), json=payload)
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_managed_event_returned_regardless_of_page_position(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        other = _make_human(db, tenant_a, first="Other")
        manager = _make_human(db, tenant_a, first="Manager")

        # Non-managed public events with EARLY start times fill the first page.
        for day in (1, 2, 3):
            self._post(
                client,
                popup,
                other,
                {
                    "start_time": f"2026-05-0{day}T10:00:00+00:00",
                    "end_time": f"2026-05-0{day}T11:00:00+00:00",
                },
            )
        # A PRIVATE event the manager collaborates on, with a LATE start time
        # (past a small page when ordered by start_time).
        managed = self._post(
            client,
            popup,
            other,
            {
                "visibility": "private",
                "collaborator_ids": [str(manager.id)],
                "start_time": "2026-05-20T10:00:00+00:00",
                "end_time": "2026-05-20T11:00:00+00:00",
            },
        )

        resp = client.get(
            PORTAL_EVENTS,
            params={"popup_id": str(popup.id), "managed_only": "true", "limit": 2},
            headers=_human_auth(manager),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        ids = {e["id"] for e in body["results"]}
        assert ids == {managed["id"]}
        # Only the managed event is counted, so paging reflects the managed set.
        assert body["paging"]["total"] == 1

    def test_managed_only_empty_for_non_manager(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a, first="Owner")
        stranger = _make_human(db, tenant_a, first="Stranger")
        self._post(client, popup, owner, {})

        resp = client.get(
            PORTAL_EVENTS,
            params={"popup_id": str(popup.id), "managed_only": "true"},
            headers=_human_auth(stranger),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["results"] == []


class TestTrackEventCounts:
    """``/portal/events/track-counts`` aggregates per-track counts server-side."""

    def test_counts_distinct_published_events_per_track(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a, first="Owner")
        track = Tracks(tenant_id=tenant_a.id, popup_id=popup.id, name="Track A")
        db.add(track)
        db.commit()
        db.refresh(track)

        for _ in range(2):
            resp = client.post(
                PORTAL_EVENTS,
                headers=_human_auth(owner),
                json={
                    **_create_payload(popup, collaborator_ids=[]),
                    "track_id": str(track.id),
                },
            )
            assert resp.status_code == 201, resp.text

        resp = client.get(
            f"{PORTAL_EVENTS}/track-counts",
            params={"popup_id": str(popup.id)},
            headers=_human_auth(owner),
        )
        assert resp.status_code == 200, resp.text
        counts = {row["track_id"]: row["event_count"] for row in resp.json()}
        assert counts.get(str(track.id)) == 2
