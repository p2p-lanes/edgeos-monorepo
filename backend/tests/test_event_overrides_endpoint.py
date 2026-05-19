"""Tests for GET /events/{event_id}/overrides.

The endpoint surfaces detached override children of a recurring series
master so the EventForm can render a "Modified instances" section — fixes
the case where an invisible override silently blocked a new recurrent
event on the same venue.
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


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Overrides Test {uuid.uuid4().hex[:6]}",
        slug=f"overrides-{uuid.uuid4().hex[:10]}",
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
    recurrence_master_id: uuid.UUID | None = None,
    title: str = "Overrides Event",
) -> Events:
    ev = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title=title,
        start_time=start,
        end_time=start + timedelta(hours=1),
        timezone="UTC",
        visibility=EventVisibility.PUBLIC,
        status=EventStatus.PUBLISHED,
        rrule=rrule,
        recurrence_master_id=recurrence_master_id,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


class TestListOverrides:
    """GET /events/{event_id}/overrides."""

    def test_list_overrides_returns_only_children_of_master(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        master = _make_event(
            db,
            tenant_a,
            popup,
            start=datetime(2026, 6, 1, 14, 0, tzinfo=UTC),
            rrule="FREQ=WEEKLY;INTERVAL=1;COUNT=4",
            title="Series master",
        )
        # Two children attached to the master.
        child_a = _make_event(
            db,
            tenant_a,
            popup,
            start=datetime(2026, 6, 8, 14, 0, tzinfo=UTC),
            recurrence_master_id=master.id,
            title="Child A",
        )
        child_b = _make_event(
            db,
            tenant_a,
            popup,
            start=datetime(2026, 6, 15, 14, 0, tzinfo=UTC),
            recurrence_master_id=master.id,
            title="Child B",
        )
        # Unrelated standalone event — must NOT appear.
        _make_event(
            db,
            tenant_a,
            popup,
            start=datetime(2026, 6, 22, 14, 0, tzinfo=UTC),
            title="Unrelated",
        )

        resp = client.get(
            f"/api/v1/events/{master.id}/overrides",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        ids = {row["id"] for row in body}
        assert ids == {str(child_a.id), str(child_b.id)}
        # Sorted by start_time asc.
        assert body[0]["id"] == str(child_a.id)
        assert body[1]["id"] == str(child_b.id)

    def test_list_overrides_empty_for_non_recurring_event(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        ev = _make_event(
            db,
            tenant_a,
            popup,
            start=datetime(2026, 7, 1, 14, 0, tzinfo=UTC),
            title="One-off",
        )
        resp = client.get(
            f"/api/v1/events/{ev.id}/overrides",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

    def test_list_overrides_404_for_unknown_id(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get(
            f"/api/v1/events/{uuid.uuid4()}/overrides",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 404, resp.text
