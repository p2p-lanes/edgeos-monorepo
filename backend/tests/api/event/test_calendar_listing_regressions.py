"""Listing regressions found while testing the calendar end to end (2026-09).

- GET /events pages the expanded occurrence list: ``total`` counts
  occurrences, no page exceeds ``limit``, and paging is chronological.
- GET /events/portal/events/calendar-summary counts group-private events
  for group members, matching the list.
- PATCH /events rejects a one-sided move that leaves end before start.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.event_settings.schemas import PublishPermission
from app.api.group.models import GroupMembers, Groups
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import group_flow_id


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Cal Regress {uuid.uuid4().hex[:6]}",
        slug=f"cal-regress-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        group_private_events_enabled=True,
    )
    db.add(popup)
    db.flush()
    db.add(
        EventSettings(
            tenant_id=tenant.id,
            popup_id=popup.id,
            timezone="UTC",
            event_enabled=True,
            can_publish_event=PublishPermission.EVERYONE,
        )
    )
    db.commit()
    db.refresh(popup)
    return popup


def _make_event(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    start: datetime,
    *,
    title: str = "Cal Event",
    rrule: str | None = None,
    visibility: EventVisibility = EventVisibility.PUBLIC,
    group_id: uuid.UUID | None = None,
) -> Events:
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title=title,
        start_time=start,
        end_time=start + timedelta(hours=1),
        timezone="UTC",
        visibility=visibility,
        status=EventStatus.PUBLISHED,
        rrule=rrule,
        group_id=group_id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def test_admin_list_pages_expanded_occurrences(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    popup = _make_popup(db, tenant_a)
    base = datetime(2031, 3, 3, 10, 0, tzinfo=UTC)
    # A 5-week series interleaved with 4 one-off events.
    _make_event(db, tenant_a, popup, base, title="series", rrule="FREQ=WEEKLY;COUNT=5")
    for week in range(4):
        _make_event(
            db,
            tenant_a,
            popup,
            base + timedelta(weeks=week, days=2),
            title=f"one-{week}",
        )
    window = {
        "popup_id": str(popup.id),
        "start_after": (base - timedelta(days=1)).isoformat(),
        "start_before": (base + timedelta(weeks=6)).isoformat(),
    }

    seen: list[tuple[str, str]] = []
    skip = 0
    while True:
        resp = client.get(
            "/api/v1/events",
            params={**window, "skip": skip, "limit": 3},
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["paging"]["total"] == 9
        assert len(body["results"]) <= 3
        seen += [(r["start_time"], r["title"]) for r in body["results"]]
        skip += 3
        if skip >= body["paging"]["total"]:
            break

    assert len(seen) == 9
    assert len(set(seen)) == 9
    starts = [datetime.fromisoformat(s.replace("Z", "+00:00")) for s, _ in seen]
    assert starts == sorted(starts)


def test_calendar_summary_counts_group_private_events_for_members(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a)
    group = Groups(
        sales_flow_id=group_flow_id(db, popup.id),
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name=f"Cal Group {uuid.uuid4().hex[:6]}",
        slug=f"cal-grp-{uuid.uuid4().hex[:8]}",
        enable_private_events=True,
    )
    member = Humans(
        tenant_id=tenant_a.id,
        email=f"cal-member-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Cal",
        last_name="Member",
    )
    db.add(group)
    db.add(member)
    db.commit()
    db.add(GroupMembers(tenant_id=tenant_a.id, group_id=group.id, human_id=member.id))
    db.commit()

    start = datetime(2031, 3, 5, 12, 0, tzinfo=UTC)
    _make_event(
        db,
        tenant_a,
        popup,
        start,
        title="group only",
        visibility=EventVisibility.PRIVATE,
        group_id=group.id,
    )
    params = {
        "popup_id": str(popup.id),
        "start_after": datetime(2031, 3, 1, tzinfo=UTC).isoformat(),
        "start_before": datetime(2031, 4, 1, tzinfo=UTC).isoformat(),
    }
    headers = _auth(create_access_token(subject=member.id, token_type="human"))

    listed = client.get("/api/v1/events/portal/events", params=params, headers=headers)
    assert listed.status_code == 200, listed.text
    assert [e["title"] for e in listed.json()["results"]] == ["group only"]

    summary = client.get(
        "/api/v1/events/portal/events/calendar-summary", params=params, headers=headers
    )
    assert summary.status_code == 200, summary.text
    assert summary.json() == [{"day": "2031-03-05", "count": 1}]


def test_patch_rejects_start_moved_past_stored_end(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    popup = _make_popup(db, tenant_a)
    event = _make_event(db, tenant_a, popup, datetime(2031, 3, 5, 12, 0, tzinfo=UTC))

    resp = client.patch(
        f"/api/v1/events/{event.id}",
        json={"start_time": (event.start_time + timedelta(hours=2)).isoformat()},
        headers=_auth(admin_token_tenant_a),
    )

    assert resp.status_code == 422, resp.text
    assert "end_time must not be before start_time" in resp.text
