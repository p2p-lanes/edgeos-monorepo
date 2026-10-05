"""Detail dates, participant lists and counters must describe one occurrence."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_participant.crud import event_participants_crud
from app.api.event_participant.models import EventParticipants
from app.api.event_participant.schemas import ParticipantStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


@pytest.fixture
def series(db: Session, tenant_a: Tenants):
    popup = Popups(
        tenant_id=tenant_a.id,
        name="Occurrence context test",
        slug=f"occurrence-{uuid.uuid4().hex[:10]}",
    )
    db.add(popup)
    db.flush()
    humans = [
        Humans(
            tenant_id=tenant_a.id,
            email=f"occurrence-{uuid.uuid4().hex}@test.com",
            first_name=f"Attendee {i}",
        )
        for i in range(3)
    ]
    db.add_all(humans)
    db.flush()
    start = datetime(2031, 3, 3, 10, tzinfo=UTC)
    event = Events(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        owner_id=humans[0].id,
        title="Recurring context",
        start_time=start,
        end_time=start + timedelta(hours=1),
        timezone="UTC",
        rrule="FREQ=DAILY;COUNT=3",
        visibility=EventVisibility.PUBLIC,
        status=EventStatus.PUBLISHED,
    )
    db.add(event)
    db.flush()
    for person, date, state in [
        (humans[0], start, ParticipantStatus.REGISTERED),
        (humans[0], start + timedelta(days=1), ParticipantStatus.REGISTERED),
        (humans[1], start + timedelta(days=1), ParticipantStatus.CHECKED_IN),
        (humans[2], start + timedelta(days=1), ParticipantStatus.CANCELLED),
    ]:
        db.add(
            EventParticipants(
                tenant_id=tenant_a.id,
                event_id=event.id,
                profile_id=person.id,
                occurrence_start=date,
                status=state,
            )
        )
    db.commit()
    return event, humans, start


def human_headers(human: Humans):
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def parse_date(value: str):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@pytest.mark.parametrize("surface", ["admin", "portal"])
@pytest.mark.parametrize("selected_day", [None, 0, 1, 2])
def test_detail_resolves_dates_count_and_rsvp(
    client: TestClient, series, admin_token_tenant_a: str, surface, selected_day
):
    event, humans, start = series
    day = selected_day or 0
    occurrence = start + timedelta(days=day)
    path = (
        f"/api/v1/events/{event.id}"
        if surface == "admin"
        else f"/api/v1/events/portal/events/{event.id}"
    )
    headers = (
        {"Authorization": f"Bearer {admin_token_tenant_a}"}
        if surface == "admin"
        else human_headers(humans[0])
    )
    response = client.get(
        path,
        headers=headers,
        params={}
        if selected_day is None
        else {"occurrence_start": occurrence.isoformat()},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert parse_date(body["resolved_occurrence_start"]) == occurrence
    assert parse_date(body["start_time"]) == occurrence
    assert parse_date(body["end_time"]) == occurrence + timedelta(hours=1)
    assert body["attendee_count"] == [1, 2, 0][day]
    if surface == "portal":
        assert body["my_rsvp_status"] == ("registered" if day < 2 else None)


@pytest.mark.parametrize("surface", ["admin", "portal"])
def test_participants_scoped_and_legacy_series_listing(
    client: TestClient, series, admin_token_tenant_a: str, surface
):
    event, humans, start = series
    headers = (
        {"Authorization": f"Bearer {admin_token_tenant_a}"}
        if surface == "admin"
        else human_headers(humans[0])
    )
    path = (
        "/api/v1/event-participants"
        if surface == "admin"
        else "/api/v1/event-participants/portal/participants"
    )
    for params, expected in [
        ({}, 4),
        ({"occurrence_start": start.isoformat()}, 1),
        ({"occurrence_start": (start + timedelta(days=1)).isoformat()}, 3),
        ({"occurrence_start": (start + timedelta(days=2)).isoformat()}, 0),
    ]:
        response = client.get(
            path,
            headers=headers,
            params={"event_id": str(event.id), **params},
        )
        assert response.status_code == 200, response.text
        assert response.json()["paging"]["total"] == expected
        assert len(response.json()["results"]) == expected


@pytest.mark.parametrize("surface", ["admin", "portal"])
def test_list_counts_each_occurrence_not_the_series(
    client: TestClient, series, admin_token_tenant_a: str, surface
):
    event, humans, start = series
    response = client.get(
        "/api/v1/events" if surface == "admin" else "/api/v1/events/portal/events",
        headers=(
            {"Authorization": f"Bearer {admin_token_tenant_a}"}
            if surface == "admin"
            else human_headers(humans[0])
        ),
        params={
            "popup_id": str(event.popup_id),
            "start_after": start.isoformat(),
            "start_before": (start + timedelta(days=3)).isoformat(),
        },
    )
    assert response.status_code == 200, response.text
    rows = response.json()["results"]
    assert len(rows) == 3
    assert [r["attendee_count"] for r in rows] == [1, 2, 0]


def test_excluding_host_does_not_scope_series_to_null(db: Session, series):
    event, humans, _ = series
    rows, total = event_participants_crud.find_by_event(
        db, event.id, exclude_profile_id=humans[0].id
    )
    assert total == 2
    assert {r.profile_id for r in rows} == {humans[1].id, humans[2].id}


def test_host_excluded_from_occurrence_count_and_lists(
    client: TestClient, db: Session, series, admin_token_tenant_a: str
):
    event, humans, start = series
    event.host_id = humans[0].id
    db.add(event)
    db.commit()
    occurrence = start + timedelta(days=1)
    for surface in ["admin", "portal"]:
        prefix = (
            "/api/v1/events" if surface == "admin" else "/api/v1/events/portal/events"
        )
        participants = (
            "/api/v1/event-participants"
            if surface == "admin"
            else "/api/v1/event-participants/portal/participants"
        )
        headers = (
            {"Authorization": f"Bearer {admin_token_tenant_a}"}
            if surface == "admin"
            else human_headers(humans[0])
        )
        params = {"occurrence_start": occurrence.isoformat()}
        detail = client.get(f"{prefix}/{event.id}", headers=headers, params=params)
        assert detail.status_code == 200, detail.text
        assert detail.json()["attendee_count"] == 1
        listing = client.get(
            participants, headers=headers, params={"event_id": str(event.id), **params}
        )
        assert listing.status_code == 200, listing.text
        assert str(humans[0].id) not in {
            r["profile_id"] for r in listing.json()["results"]
        }


@pytest.mark.parametrize(
    "date", ["2031-03-10T10:00:00Z", "2031-03-03T11:00:00Z", "2031-03-03T10:00:00"]
)
def test_invalid_detail_occurrence_rejected(
    client: TestClient, series, admin_token_tenant_a: str, date
):
    event, humans, _ = series
    for path, headers in [
        (
            f"/api/v1/events/{event.id}",
            {"Authorization": f"Bearer {admin_token_tenant_a}"},
        ),
        (f"/api/v1/events/portal/events/{event.id}", human_headers(humans[0])),
        (
            "/api/v1/event-participants",
            {"Authorization": f"Bearer {admin_token_tenant_a}"},
        ),
        ("/api/v1/event-participants/portal/participants", human_headers(humans[0])),
        ("/api/v1/event-participants/portal/attendee-emails", human_headers(humans[0])),
    ]:
        response = client.get(
            path,
            headers=headers,
            params={"event_id": str(event.id), "occurrence_start": date},
        )
        assert response.status_code == 400, response.text


def test_detached_child_owns_portal_rsvp_and_my_events(
    client: TestClient, db: Session, series, tenant_a: Tenants
):
    master, humans, start = series
    child = Events(
        tenant_id=tenant_a.id,
        popup_id=master.popup_id,
        owner_id=humans[0].id,
        title="Detached instance",
        start_time=start + timedelta(days=4),
        end_time=start + timedelta(days=4, hours=1),
        timezone="UTC",
        recurrence_master_id=master.id,
        status=EventStatus.PUBLISHED,
        visibility=EventVisibility.PUBLIC,
    )
    db.add(child)
    db.flush()
    db.add(
        EventParticipants(
            tenant_id=tenant_a.id,
            event_id=child.id,
            profile_id=humans[0].id,
            occurrence_start=None,
        )
    )
    db.commit()
    headers = human_headers(humans[0])
    detail = client.get(f"/api/v1/events/portal/events/{child.id}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["resolved_occurrence_start"] is None
    assert detail.json()["my_rsvp_status"] == "registered"
    assert detail.json()["attendee_count"] == 1
    listing = client.get(
        "/api/v1/events/portal/events",
        headers=headers,
        params={"popup_id": str(master.popup_id), "rsvped_only": True},
    )
    assert listing.status_code == 200, listing.text
    child_rows = [r for r in listing.json()["results"] if r["id"] == str(child.id)]
    assert len(child_rows) == 1
    assert child_rows[0]["my_rsvp_status"] == "registered"
    assert child_rows[0]["attendee_count"] == 1
    invalid = client.get(
        f"/api/v1/events/portal/events/{child.id}",
        headers=headers,
        params={"occurrence_start": child.start_time.isoformat()},
    )
    assert invalid.status_code == 400


def test_oneoff_admin_detail_and_participants_exclude_host(
    client: TestClient,
    db: Session,
    series,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
):
    master, humans, start = series
    event = Events(
        tenant_id=tenant_a.id,
        popup_id=master.popup_id,
        owner_id=humans[0].id,
        host_id=humans[0].id,
        title="One-off with legacy host registration",
        start_time=start,
        end_time=start + timedelta(hours=1),
        status=EventStatus.PUBLISHED,
    )
    db.add(event)
    db.flush()
    for human in humans[:2]:
        db.add(
            EventParticipants(
                tenant_id=tenant_a.id, event_id=event.id, profile_id=human.id
            )
        )
    db.commit()
    headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}
    detail = client.get(f"/api/v1/events/{event.id}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["resolved_occurrence_start"] is None
    assert detail.json()["attendee_count"] == 1
    listing = client.get(
        "/api/v1/event-participants",
        headers=headers,
        params={"event_id": str(event.id)},
    )
    assert listing.status_code == 200, listing.text
    assert [r["profile_id"] for r in listing.json()["results"]] == [str(humans[1].id)]


def test_detail_normalizes_equivalent_offset_to_utc(
    client: TestClient, series, admin_token_tenant_a: str
):
    event, _, start = series
    response = client.get(
        f"/api/v1/events/{event.id}",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        params={"occurrence_start": "2031-03-04T15:30:00+05:30"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["resolved_occurrence_start"] == "2031-03-04T10:00:00Z"
    assert parse_date(body["start_time"]) == start + timedelta(days=1)
    assert body["attendee_count"] == 2
