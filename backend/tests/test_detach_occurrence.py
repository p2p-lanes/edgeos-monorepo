"""Tests for POST /events/{event_id}/detach-occurrence.

Detaching a single occurrence of a recurring series materializes it as its
own standalone row. These tests pin the three fixes for the duplicate /
empty-RSVP bug:

- idempotency: re-detaching the same occurrence returns the existing child
  instead of creating a second duplicate row;
- RSVP re-pointing: the occurrence's participants follow the new child row
  instead of being orphaned on the master;
- field copy: custom location / host / collaborators / highlighted are
  carried over to the child.

Email delivery is mocked at the ``send_event_itip`` boundary so no SMTP is
attempted.
"""

from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_participant.crud import event_participants_crud
from app.api.event_participant.models import EventParticipants
from app.api.event_participant.schemas import ParticipantStatus
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _mute_itip() -> Generator[None, None, None]:
    """Stub out iTIP email dispatch so detach makes no SMTP calls."""
    with (
        patch("app.services.event_itip.send_event_itip", new=AsyncMock()),
        patch("app.api.event.router._send_event_itip", new=AsyncMock()),
    ):
        yield


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Detach Test {uuid.uuid4().hex[:6]}",
        slug=f"detach-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_master(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    start: datetime,
    **extra: object,
) -> Events:
    ev = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title="Series master",
        start_time=start,
        end_time=start + timedelta(hours=1),
        timezone="UTC",
        visibility=EventVisibility.PUBLIC,
        status=EventStatus.PUBLISHED,
        rrule="FREQ=WEEKLY;INTERVAL=1;COUNT=4",
        **extra,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


def _add_participant(
    db: Session,
    tenant: Tenants,
    event_id: uuid.UUID,
    occurrence_start: datetime | None,
) -> EventParticipants:
    row = EventParticipants(
        tenant_id=tenant.id,
        event_id=event_id,
        profile_id=uuid.uuid4(),
        status=ParticipantStatus.REGISTERED,
        occurrence_start=occurrence_start,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


class TestDetachIdempotency:
    def test_redetaching_same_occurrence_returns_existing_child(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        master = _make_master(
            db, tenant_a, popup, start=datetime(2026, 6, 5, 14, 0, tzinfo=UTC)
        )
        occ = "2026-06-12T14:00:00+00:00"

        first = client.post(
            f"/api/v1/events/{master.id}/detach-occurrence",
            headers=_auth(admin_token_tenant_a),
            json={"occurrence_start": occ},
        )
        assert first.status_code == 200, first.text
        second = client.post(
            f"/api/v1/events/{master.id}/detach-occurrence",
            headers=_auth(admin_token_tenant_a),
            json={"occurrence_start": occ},
        )
        assert second.status_code == 200, second.text

        # Same child returned, and only ONE override exists.
        assert first.json()["id"] == second.json()["id"]
        overrides = client.get(
            f"/api/v1/events/{master.id}/overrides",
            headers=_auth(admin_token_tenant_a),
        )
        assert overrides.status_code == 200, overrides.text
        assert len(overrides.json()) == 1


class TestDetachRepointsRsvps:
    def test_occurrence_rsvps_follow_the_child(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        master = _make_master(
            db, tenant_a, popup, start=datetime(2026, 6, 5, 14, 0, tzinfo=UTC)
        )
        target_occ = datetime(2026, 6, 12, 14, 0, tzinfo=UTC)
        other_occ = datetime(2026, 6, 19, 14, 0, tzinfo=UTC)
        # Two RSVPs on the occurrence we detach, one on a different occurrence.
        _add_participant(db, tenant_a, master.id, target_occ)
        _add_participant(db, tenant_a, master.id, target_occ)
        _add_participant(db, tenant_a, master.id, other_occ)

        resp = client.post(
            f"/api/v1/events/{master.id}/detach-occurrence",
            headers=_auth(admin_token_tenant_a),
            json={"occurrence_start": target_occ.isoformat()},
        )
        assert resp.status_code == 200, resp.text
        child_id = uuid.UUID(resp.json()["id"])

        db.expire_all()
        # The two target-occurrence RSVPs moved onto the child as one-off rows.
        child_rows, child_total = event_participants_crud.find_by_event(
            db, event_id=child_id
        )
        assert child_total == 2
        assert all(r.occurrence_start is None for r in child_rows)
        # The other occurrence's RSVP stays on the master, untouched.
        assert (
            event_participants_crud.count_active_for_event(
                db, master.id, occurrence_start=target_occ
            )
            == 0
        )
        assert (
            event_participants_crud.count_active_for_event(
                db, master.id, occurrence_start=other_occ
            )
            == 1
        )


class TestDetachCopiesFields:
    def test_child_inherits_custom_location_and_metadata(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        host_id = uuid.uuid4()
        collaborator_ids = [uuid.uuid4(), uuid.uuid4()]
        master = _make_master(
            db,
            tenant_a,
            popup,
            start=datetime(2026, 6, 5, 14, 0, tzinfo=UTC),
            custom_location_name="Barbieri Park",
            custom_location_url="https://maps.example/park",
            host_id=host_id,
            host_display_name="Women's Health Summit",
            collaborator_ids=collaborator_ids,
            highlighted=True,
        )

        resp = client.post(
            f"/api/v1/events/{master.id}/detach-occurrence",
            headers=_auth(admin_token_tenant_a),
            json={"occurrence_start": "2026-06-12T14:00:00+00:00"},
        )
        assert resp.status_code == 200, resp.text
        child = resp.json()
        assert child["custom_location_name"] == "Barbieri Park"
        assert child["custom_location_url"] == "https://maps.example/park"
        assert child["host_id"] == str(host_id)
        assert child["host_display_name"] == "Women's Health Summit"
        assert set(child["collaborator_ids"]) == {str(c) for c in collaborator_ids}
        assert child["highlighted"] is True
        # And it's a standalone override of the master.
        assert child["recurrence_master_id"] == str(master.id)
        assert child["rrule"] is None
