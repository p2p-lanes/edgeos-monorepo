"""Integration tests for event CRUD + recurrence/override semantics.

Complements:

- ``test_recurrence.py`` — pure RRULE parsing / expansion (no DB).
- ``test_event_itip.py`` — SEQUENCE bumps + iTIP dispatch on mutations.

This file covers:

- POST /events creates a row with the payload status (defaults to DRAFT).
- POST /events with a ``recurrence`` payload serializes an RRULE.
- PATCH /events/{id}/recurrence sets / replaces / clears the rule and
  wipes stale EXDATEs.
- PATCH /events/{id}/recurrence on a detached occurrence child is
  rejected with 400.
- POST /events/{id}/detach-occurrence creates a child with
  ``recurrence_master_id`` set, no ``rrule``, same duration as the
  master, and appends an EXDATE to the master.
- POST /events/{id}/detach-occurrence on a non-recurring event → 400.
- DELETE /events/{id}/occurrence appends an EXDATE without deleting
  the master.
- DELETE /events/{id}/occurrence on a non-recurring event → 400.
- Listing a recurring series with ``start_after`` / ``start_before``
  expands into pseudo-occurrences; a persisted override suppresses the
  pseudo for its own date.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"CRUD Test {uuid.uuid4().hex[:6]}",
        slug=f"crud-events-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_event(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    start: datetime,
    rrule: str | None = None,
    status: EventStatus = EventStatus.PUBLISHED,
    exdates: list[str] | None = None,
    recurrence_master_id: uuid.UUID | None = None,
    duration_hours: int = 1,
) -> Events:
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title="CRUD Event",
        start_time=start,
        end_time=start + timedelta(hours=duration_hours),
        timezone="UTC",
        visibility=EventVisibility.PUBLIC,
        status=status,
        rrule=rrule,
        recurrence_master_id=recurrence_master_id,
        recurrence_exdates=exdates or [],
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


class TestCreateEvent:
    """POST /events."""

    def test_create_one_off_defaults_to_draft(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime.now(UTC) + timedelta(days=14)

        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "Launch",
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
            },
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == EventStatus.DRAFT.value
        assert body["rrule"] is None
        assert body["recurrence_master_id"] is None
        assert body["recurrence_exdates"] == []

    def test_create_with_recurrence_serializes_rrule(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime.now(UTC) + timedelta(days=14)

        resp = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "Weekly Standup",
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
                "recurrence": {
                    "freq": "WEEKLY",
                    "interval": 1,
                    "by_day": ["TU", "TH"],
                    "count": 4,
                },
            },
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["rrule"] == "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU,TH;COUNT=4"


# ---------------------------------------------------------------------------
# PATCH /events/{id}/recurrence
# ---------------------------------------------------------------------------


class TestPatchRecurrence:
    """PATCH /events/{id}/recurrence."""

    def test_set_recurrence_on_one_off_persists_rule(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime.now(UTC) + timedelta(days=14)
        event = _make_event(db, tenant_a, popup, start=start)

        resp = client.patch(
            f"/api/v1/events/{event.id}/recurrence",
            headers=_auth(admin_token_tenant_a),
            json={
                "recurrence": {
                    "freq": "DAILY",
                    "interval": 1,
                    "count": 5,
                }
            },
        )

        assert resp.status_code == 200, resp.text
        db.expire_all()
        refreshed = db.get(Events, event.id)
        assert refreshed.rrule == "FREQ=DAILY;INTERVAL=1;COUNT=5"

    def test_clear_recurrence_wipes_exdates(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        event = _make_event(
            db,
            tenant_a,
            popup,
            start=start,
            rrule="FREQ=WEEKLY;INTERVAL=1;COUNT=4",
            exdates=[(start + timedelta(days=7)).isoformat()],
        )

        resp = client.patch(
            f"/api/v1/events/{event.id}/recurrence",
            headers=_auth(admin_token_tenant_a),
            json={"recurrence": None},
        )

        assert resp.status_code == 200, resp.text
        db.expire_all()
        refreshed = db.get(Events, event.id)
        assert refreshed.rrule is None
        assert list(refreshed.recurrence_exdates or []) == []

    def test_patch_recurrence_on_detached_occurrence_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        master = _make_event(
            db,
            tenant_a,
            popup,
            start=start,
            rrule="FREQ=DAILY;INTERVAL=1;COUNT=3",
        )
        child = _make_event(
            db,
            tenant_a,
            popup,
            start=start + timedelta(days=1),
            recurrence_master_id=master.id,
        )

        resp = client.patch(
            f"/api/v1/events/{child.id}/recurrence",
            headers=_auth(admin_token_tenant_a),
            json={"recurrence": {"freq": "DAILY", "interval": 1, "count": 2}},
        )

        assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------------
# Detach / delete occurrence
# ---------------------------------------------------------------------------


class TestDetachOccurrence:
    """POST /events/{id}/detach-occurrence."""

    def test_detach_creates_child_with_master_reference_and_exdate(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        master = _make_event(
            db,
            tenant_a,
            popup,
            start=start,
            rrule="FREQ=DAILY;INTERVAL=1;COUNT=3",
            duration_hours=2,
        )
        target_occ = start + timedelta(days=1)

        resp = client.post(
            f"/api/v1/events/{master.id}/detach-occurrence",
            headers=_auth(admin_token_tenant_a),
            json={"occurrence_start": target_occ.isoformat()},
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["recurrence_master_id"] == str(master.id)
        assert body["rrule"] is None
        # Duration preserved.
        start_dt = datetime.fromisoformat(body["start_time"])
        end_dt = datetime.fromisoformat(body["end_time"])
        assert end_dt - start_dt == timedelta(hours=2)

        db.expire_all()
        master_after = db.get(Events, master.id)
        exdates = list(master_after.recurrence_exdates or [])
        assert target_occ.isoformat() in exdates

    def test_detach_on_non_recurring_event_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        event = _make_event(db, tenant_a, popup, start=start)

        resp = client.post(
            f"/api/v1/events/{event.id}/detach-occurrence",
            headers=_auth(admin_token_tenant_a),
            json={"occurrence_start": start.isoformat()},
        )

        assert resp.status_code == 400, resp.text


class TestDeleteOccurrence:
    """DELETE /events/{id}/occurrence."""

    def test_delete_occurrence_appends_exdate_without_dropping_master(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        master = _make_event(
            db,
            tenant_a,
            popup,
            start=start,
            rrule="FREQ=DAILY;INTERVAL=1;COUNT=3",
        )
        target_occ = start + timedelta(days=1)

        resp = client.request(
            "DELETE",
            f"/api/v1/events/{master.id}/occurrence",
            headers=_auth(admin_token_tenant_a),
            json={"occurrence_start": target_occ.isoformat()},
        )

        assert resp.status_code == 204, resp.text
        db.expire_all()
        master_after = db.get(Events, master.id)
        assert master_after is not None
        assert target_occ.isoformat() in list(master_after.recurrence_exdates or [])

    def test_delete_occurrence_on_non_recurring_event_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        event = _make_event(db, tenant_a, popup, start=start)

        resp = client.request(
            "DELETE",
            f"/api/v1/events/{event.id}/occurrence",
            headers=_auth(admin_token_tenant_a),
            json={"occurrence_start": start.isoformat()},
        )

        assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------------
# List expansion
# ---------------------------------------------------------------------------


class TestListExpansion:
    """GET /events expands recurring masters into pseudo-occurrences.

    Expansion kicks in when the caller passes ``start_after`` / ``start_before``,
    matching how the calendar view queries a visible window.
    """

    def test_recurring_series_expands_to_pseudo_occurrences(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        master = _make_event(
            db,
            tenant_a,
            popup,
            start=start,
            rrule="FREQ=DAILY;INTERVAL=1;COUNT=3",
        )

        resp = client.get(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            params={
                "popup_id": str(popup.id),
                "start_after": start.isoformat(),
                "start_before": (start + timedelta(days=3)).isoformat(),
            },
        )

        assert resp.status_code == 200, resp.text
        results = resp.json()["results"]
        # Pseudo-rows reuse the master's id by design — the expander clones
        # every column — so we distinguish master vs. pseudos through the
        # synthetic ``occurrence_id`` field.
        master_rows = [
            r
            for r in results
            if r["id"] == str(master.id) and r["occurrence_id"] is None
        ]
        pseudos = [
            r
            for r in results
            if r["id"] == str(master.id) and r["occurrence_id"] is not None
        ]
        assert len(master_rows) == 1
        # COUNT=3 → master (day 0) + 2 generated pseudos (day 1, day 2).
        assert len(pseudos) == 2

    def test_override_suppresses_matching_pseudo(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        master = _make_event(
            db,
            tenant_a,
            popup,
            start=start,
            rrule="FREQ=DAILY;INTERVAL=1;COUNT=3",
        )
        # Detach the day-1 occurrence (create an override child).
        override_start = start + timedelta(days=1)
        detach = client.post(
            f"/api/v1/events/{master.id}/detach-occurrence",
            headers=_auth(admin_token_tenant_a),
            json={"occurrence_start": override_start.isoformat()},
        )
        assert detach.status_code == 200

        resp = client.get(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            params={
                "popup_id": str(popup.id),
                "start_after": start.isoformat(),
                "start_before": (start + timedelta(days=3)).isoformat(),
            },
        )

        assert resp.status_code == 200, resp.text
        results = resp.json()["results"]

        # The override appears as a real row (occurrence_id=None).
        override_id = detach.json()["id"]
        matches = [r for r in results if r["id"] == override_id]
        assert len(matches) == 1
        assert matches[0]["occurrence_id"] is None

        # No pseudo-row at the same instant as the override.
        pseudos_at_override = [
            r
            for r in results
            if r["occurrence_id"] is not None
            and datetime.fromisoformat(r["start_time"]) == override_start
        ]
        assert pseudos_at_override == []

    def test_exdates_suppress_pseudo_without_breaking_series(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        skipped = start + timedelta(days=1)
        master = _make_event(
            db,
            tenant_a,
            popup,
            start=start,
            rrule="FREQ=DAILY;INTERVAL=1;COUNT=3",
            exdates=[skipped.isoformat()],
        )

        resp = client.get(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            params={
                "popup_id": str(popup.id),
                "start_after": start.isoformat(),
                "start_before": (start + timedelta(days=3)).isoformat(),
            },
        )

        assert resp.status_code == 200, resp.text
        results = resp.json()["results"]
        pseudos = [r for r in results if r["occurrence_id"] is not None]
        # Original series was COUNT=3 → master + 2 pseudos; EXDATE removes 1.
        assert len(pseudos) == 1
        # Master itself is still listed.
        assert any(r["id"] == str(master.id) for r in results)
        # None of the pseudos sit on the excluded date.
        assert all(
            datetime.fromisoformat(p["start_time"]) != skipped for p in pseudos
        )
