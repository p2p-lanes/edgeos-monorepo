"""Anonymous iCalendar subscription feed for a popup (/events/public/calendar.ics).

Served by popup_id (no auth, no Origin) so calendar apps can subscribe. Only
published + public events are included; recurring masters carry their RRULE.

Each test makes a fresh popup so it is isolated from the session-scoped shared
fixtures (db / tenant_a have no per-test rollback).
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.tenant.models import Tenants


def _popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"ICS {uuid.uuid4().hex[:6]}",
        slug=f"ics-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
        status=PopupStatus.active,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _event(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    title: str,
    visibility: EventVisibility,
    status: EventStatus = EventStatus.PUBLISHED,
    rrule: str | None = None,
    recurrence_exdates: list[str] | None = None,
) -> Events:
    start = datetime.now(UTC) + timedelta(days=3)
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title=title,
        start_time=start,
        end_time=start + timedelta(hours=1),
        timezone="UTC",
        visibility=visibility,
        status=status,
        rrule=rrule,
        recurrence_exdates=recurrence_exdates or [],
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def test_feed_includes_only_public_published(client, db: Session, tenant_a: Tenants):
    popup = _popup(db, tenant_a)
    pub = _event(db, tenant_a, popup, title="Public", visibility=EventVisibility.PUBLIC)
    priv = _event(
        db, tenant_a, popup, title="Private", visibility=EventVisibility.PRIVATE
    )
    draft = _event(
        db,
        tenant_a,
        popup,
        title="Draft",
        visibility=EventVisibility.PUBLIC,
        status=EventStatus.DRAFT,
    )

    r = client.get(f"/api/v1/events/public/calendar.ics?popup_id={popup.id}")
    assert r.status_code == 200
    assert "text/calendar" in r.headers["content-type"]
    body = r.text
    assert "BEGIN:VCALENDAR" in body and "END:VCALENDAR" in body
    assert f"UID:{pub.id}@edgeos" in body
    assert f"UID:{priv.id}@edgeos" not in body
    assert f"UID:{draft.id}@edgeos" not in body


def test_feed_emits_rrule_for_recurring(client, db: Session, tenant_a: Tenants):
    popup = _popup(db, tenant_a)
    _event(
        db,
        tenant_a,
        popup,
        title="Weekly",
        visibility=EventVisibility.PUBLIC,
        rrule="FREQ=WEEKLY;BYDAY=MO",
    )
    r = client.get(f"/api/v1/events/public/calendar.ics?popup_id={popup.id}")
    assert r.status_code == 200
    assert "RRULE:FREQ=WEEKLY;BYDAY=MO" in r.text


def test_feed_emits_exdates_for_recurring(client, db: Session, tenant_a: Tenants):
    """recurrence_exdates is a JSONB array of ISO strings; the feed must
    stamp them as RFC-5545 UTC values instead of crashing (regression)."""
    popup = _popup(db, tenant_a)
    _event(
        db,
        tenant_a,
        popup,
        title="Weekly with skips",
        visibility=EventVisibility.PUBLIC,
        rrule="FREQ=WEEKLY;BYDAY=MO",
        recurrence_exdates=[
            "2026-06-15T19:00:00+00:00",
            "2026-06-22T19:00:00Z",
        ],
    )
    r = client.get(f"/api/v1/events/public/calendar.ics?popup_id={popup.id}")
    assert r.status_code == 200
    assert "EXDATE:20260615T190000Z,20260622T190000Z" in r.text


def test_feed_404_for_unknown_popup(client):
    r = client.get(f"/api/v1/events/public/calendar.ics?popup_id={uuid.uuid4()}")
    assert r.status_code == 404
