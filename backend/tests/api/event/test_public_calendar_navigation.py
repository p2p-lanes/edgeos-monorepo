"""Public calendars span the gathering, including future and ended popups."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.tenant.models import Tenants


def make_popup(
    db: Session,
    tenant: Tenants,
    *,
    year: int = 2031,
    status: PopupStatus = PopupStatus.active,
    timezone: str = "UTC",
) -> Popups:
    popup = Popups(
        name="Calendar navigation",
        slug=f"calendar-{uuid.uuid4().hex}",
        tenant_id=tenant.id,
        status=status,
        start_date=datetime(year, 3, 1),
        end_date=datetime(year, 3, 31),
    )
    db.add(popup)
    db.flush()
    db.add(EventSettings(tenant_id=tenant.id, popup_id=popup.id, timezone=timezone))
    db.commit()
    db.refresh(popup)
    return popup


def make_event(db: Session, popup: Popups, start: datetime, **kwargs) -> Events:
    event = Events(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title="Public event",
        start_time=start,
        end_time=start + timedelta(hours=1),
        timezone="UTC",
        status=EventStatus.PUBLISHED,
        visibility=EventVisibility.PUBLIC,
        **kwargs,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def calendar(client: TestClient, tenant: Tenants, popup: Popups, **params):
    return client.get(
        "/api/v1/events/public/calendar",
        headers={"X-Tenant-Id": str(tenant.id)},
        params={"popup_slug": popup.slug, **params},
    )


@pytest.mark.parametrize(
    "year,status",
    [(2031, PopupStatus.active), (2020, PopupStatus.ended), (2020, PopupStatus.active)],
)
def test_default_window_spans_popup(
    client: TestClient, db: Session, tenant_a: Tenants, year: int, status: PopupStatus
):
    popup = make_popup(db, tenant_a, year=year, status=status)
    first = make_event(db, popup, datetime(year, 3, 3, 12, tzinfo=UTC))
    make_event(
        db, popup, datetime(year, 3, 20, 12, tzinfo=UTC), rrule="FREQ=DAILY;COUNT=5"
    )
    response = calendar(client, tenant_a, popup)
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["results"]) == 6
    assert body["results"][0]["id"] == str(first.id)
    assert body["results"][-1]["start_time"].startswith(f"{year}-03-24")
    assert body["meta"]["popup_start_date"].startswith(f"{year}-03-01")
    assert body["meta"]["popup_end_date"].startswith(f"{year}-03-31")
    assert body["meta"]["popup_ended"] == (status == PopupStatus.ended)
    assert body["paging"]["total"] == 6


def test_calendar_paging_reaches_last_day(
    client: TestClient, db: Session, tenant_a: Tenants
):
    popup = make_popup(db, tenant_a)
    for i in range(205):
        make_event(db, popup, datetime(2031, 3, 3, tzinfo=UTC) + timedelta(minutes=i))
    last = make_event(db, popup, datetime(2031, 3, 30, 12, tzinfo=UTC))
    first_page = calendar(client, tenant_a, popup).json()
    assert len(first_page["results"]) == 200
    assert first_page["paging"]["total"] == 206
    second_page = calendar(client, tenant_a, popup, skip=200).json()
    assert len(second_page["results"]) == 6
    assert second_page["results"][-1]["id"] == str(last.id)
    assert second_page["paging"]["offset"] == 200


@pytest.mark.parametrize(
    "timezone,first,last",
    [
        (
            "America/Argentina/Buenos_Aires",
            "2031-03-01T03:00:00+00:00",
            "2031-04-01T02:59:00+00:00",
        ),
        (
            "Pacific/Kiritimati",
            "2031-02-28T10:00:00+00:00",
            "2031-03-31T09:59:00+00:00",
        ),
    ],
)
def test_popup_dates_use_local_days(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    timezone: str,
    first: str,
    last: str,
):
    popup = make_popup(db, tenant_a, timezone=timezone)
    start, end = datetime.fromisoformat(first), datetime.fromisoformat(last)
    before = make_event(db, popup, start - timedelta(minutes=1))
    first_event = make_event(db, popup, start)
    last_event = make_event(db, popup, end)
    after = make_event(db, popup, end + timedelta(minutes=1))
    response = calendar(client, tenant_a, popup)
    assert response.status_code == 200, response.text
    ids = {e["id"] for e in response.json()["results"]}
    assert ids == {str(first_event.id), str(last_event.id)}
    assert str(before.id) not in ids and str(after.id) not in ids


def test_explicit_window_still_supported(
    client: TestClient, db: Session, tenant_a: Tenants
):
    popup = make_popup(db, tenant_a)
    make_event(db, popup, datetime(2031, 3, 3, 12, tzinfo=UTC))
    selected = make_event(db, popup, datetime(2031, 3, 20, 12, tzinfo=UTC))
    response = calendar(
        client,
        tenant_a,
        popup,
        start_after="2031-03-20T00:00:00Z",
        start_before="2031-03-21T00:00:00Z",
    )
    assert response.status_code == 200, response.text
    assert [e["id"] for e in response.json()["results"]] == [str(selected.id)]


@pytest.mark.parametrize("status", [PopupStatus.draft, PopupStatus.archived])
def test_nonpublic_popups_remain_opaque(
    client: TestClient, db: Session, tenant_a: Tenants, status: PopupStatus
):
    popup = make_popup(db, tenant_a, status=status)
    assert calendar(client, tenant_a, popup).status_code == 404


def test_ended_popup_does_not_leak_to_other_tenants(
    client: TestClient, db: Session, tenant_a: Tenants, tenant_b: Tenants
):
    popup = make_popup(db, tenant_a, status=PopupStatus.ended)
    assert calendar(client, tenant_b, popup).status_code == 404


def test_long_popup_reaches_last_recurring_occurrence(
    client: TestClient, db: Session, tenant_a: Tenants
):
    popup = make_popup(db, tenant_a, year=2020, status=PopupStatus.ended)
    popup.end_date = datetime(2020, 6, 30)
    db.add(popup)
    db.commit()
    start = datetime(2020, 3, 3, 12, tzinfo=UTC)
    make_event(db, popup, start, rrule="FREQ=DAILY;COUNT=115")
    response = calendar(client, tenant_a, popup)
    assert response.status_code == 200, response.text
    rows = response.json()["results"]
    assert len(rows) == 115
    last = datetime.fromisoformat(rows[-1]["start_time"].replace("Z", "+00:00"))
    assert last == start + timedelta(days=114)
