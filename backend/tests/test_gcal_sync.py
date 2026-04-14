"""Unit tests for the Google Calendar sync service.

Uses a FakeCalendarClient that records calls instead of hitting Google's
API. The happy-path asserts that:
- First sync inserts and persists a mirror row.
- Second sync patches the same gcal event.
- delete_event_for_human removes the mirror and invokes delete on the client.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.google_calendar import service as gcal_service
from app.api.google_calendar.models import (
    EventGcalSync,
    HumanGoogleCredentials,
)
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeCalendarClient:
    """In-memory calendar client implementing the CalendarClient protocol."""

    def __init__(self) -> None:
        self.inserts: list[dict[str, Any]] = []
        self.patches: list[dict[str, Any]] = []
        self.deletes: list[tuple[str, str]] = []
        self._counter = 0

    def insert_event(
        self, calendar_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        self._counter += 1
        self.inserts.append({"calendar_id": calendar_id, "body": body})
        return {"id": f"gcal-event-{self._counter}", "etag": f"etag-{self._counter}"}

    def patch_event(
        self, calendar_id: str, event_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        self.patches.append(
            {"calendar_id": calendar_id, "event_id": event_id, "body": body}
        )
        return {"id": event_id, "etag": f"etag-after-{len(self.patches)}"}

    def delete_event(self, calendar_id: str, event_id: str) -> None:
        self.deletes.append((calendar_id, event_id))


# ---------------------------------------------------------------------------
# Fixtures (plain helpers — pytest-style fixtures from conftest.py are reused)
# ---------------------------------------------------------------------------


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    email = f"gcal-{suffix}-{uuid.uuid4().hex[:6]}@test.com"
    human = Humans(
        tenant_id=tenant.id,
        email=email,
        first_name="GCal",
        last_name=suffix,
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_event(db: Session, tenant: Tenants, popup: Popups) -> Events:
    start = datetime.now(UTC) + timedelta(days=1)
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title="Test Event",
        content="A nice event",
        start_time=start,
        end_time=start + timedelta(hours=1),
        timezone="UTC",
        visibility=EventVisibility.PUBLIC,
        status=EventStatus.PUBLISHED,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _make_credentials(
    db: Session, tenant: Tenants, human: Humans
) -> HumanGoogleCredentials:
    creds = HumanGoogleCredentials(
        tenant_id=tenant.id,
        human_id=human.id,
        access_token="fake-access",
        refresh_token="fake-refresh",
        token_expiry=datetime.now(UTC) + timedelta(hours=1),
        scope="https://www.googleapis.com/auth/calendar.events",
        google_calendar_id="primary",
    )
    db.add(creds)
    db.commit()
    db.refresh(creds)
    return creds


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_sync_event_to_human_inserts_then_patches(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    monkeypatch,
):
    """First call inserts; second call patches the same gcal event id."""
    # Force "configured" to True so the service doesn't early-return.
    monkeypatch.setattr(gcal_service, "is_configured", lambda: True)

    human = _make_human(db, tenant_a, suffix="insert-patch")
    _make_credentials(db, tenant_a, human)
    event = _make_event(db, tenant_a, popup_tenant_a)
    client = FakeCalendarClient()

    # Insert
    row1 = gcal_service.sync_event_to_human(db, event, human.id, client=client)
    assert row1 is not None
    assert row1.gcal_event_id == "gcal-event-1"
    assert row1.etag == "etag-1"
    assert len(client.inserts) == 1
    assert client.inserts[0]["body"]["summary"] == "Test Event"
    assert client.inserts[0]["body"]["start"]["timeZone"] == "UTC"
    assert len(client.patches) == 0

    # Patch
    event.title = "Renamed Event"
    db.add(event)
    db.commit()
    db.refresh(event)

    row2 = gcal_service.sync_event_to_human(db, event, human.id, client=client)
    assert row2 is not None
    assert row2.id == row1.id
    assert row2.gcal_event_id == "gcal-event-1"  # same gcal event
    assert len(client.inserts) == 1  # no new insert
    assert len(client.patches) == 1
    assert client.patches[0]["event_id"] == "gcal-event-1"
    assert client.patches[0]["body"]["summary"] == "Renamed Event"


def test_sync_event_skips_when_not_connected(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    monkeypatch,
):
    """No credentials => no-op (returns None, no client calls)."""
    monkeypatch.setattr(gcal_service, "is_configured", lambda: True)

    human = _make_human(db, tenant_a, suffix="no-creds")
    event = _make_event(db, tenant_a, popup_tenant_a)
    client = FakeCalendarClient()

    result = gcal_service.sync_event_to_human(db, event, human.id, client=client)
    assert result is None
    assert client.inserts == []
    assert client.patches == []


def test_sync_event_skips_when_not_configured(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    monkeypatch,
):
    """GOOGLE_OAUTH_* unset => silently skip."""
    monkeypatch.setattr(gcal_service, "is_configured", lambda: False)

    human = _make_human(db, tenant_a, suffix="not-configured")
    _make_credentials(db, tenant_a, human)
    event = _make_event(db, tenant_a, popup_tenant_a)
    client = FakeCalendarClient()

    result = gcal_service.sync_event_to_human(db, event, human.id, client=client)
    assert result is None
    assert client.inserts == []


def test_delete_event_removes_mirror(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    monkeypatch,
):
    """delete_event_for_human deletes gcal event and removes the row."""
    monkeypatch.setattr(gcal_service, "is_configured", lambda: True)

    human = _make_human(db, tenant_a, suffix="delete")
    _make_credentials(db, tenant_a, human)
    event = _make_event(db, tenant_a, popup_tenant_a)
    client = FakeCalendarClient()

    gcal_service.sync_event_to_human(db, event, human.id, client=client)
    mirror_id = db.exec(
        select(EventGcalSync)
        .where(EventGcalSync.event_id == event.id)
        .where(EventGcalSync.human_id == human.id)
    ).first()
    assert mirror_id is not None

    gcal_service.delete_event_for_human(db, event, human.id, client=client)

    assert client.deletes == [("primary", "gcal-event-1")]
    still_there = db.exec(
        select(EventGcalSync)
        .where(EventGcalSync.event_id == event.id)
        .where(EventGcalSync.human_id == human.id)
    ).first()
    assert still_there is None


def test_sync_cancelled_event_marks_status(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    monkeypatch,
):
    """A cancelled event is pushed with status=cancelled."""
    monkeypatch.setattr(gcal_service, "is_configured", lambda: True)

    human = _make_human(db, tenant_a, suffix="cancel")
    _make_credentials(db, tenant_a, human)
    event = _make_event(db, tenant_a, popup_tenant_a)
    client = FakeCalendarClient()

    gcal_service.sync_event_to_human(db, event, human.id, client=client)

    event.status = EventStatus.CANCELLED
    db.add(event)
    db.commit()
    db.refresh(event)

    gcal_service.sync_event_to_human(db, event, human.id, client=client)
    assert client.patches[-1]["body"]["status"] == "cancelled"
