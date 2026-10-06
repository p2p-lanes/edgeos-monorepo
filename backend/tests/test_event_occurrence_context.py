"""Occurrence roster reads must not change event or registration behavior."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_participant.models import EventParticipants
from app.api.event_participant.schemas import ParticipantStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


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


def roster(client, event, token, **params):
    return client.get(
        "/api/v1/event-participants",
        headers={"Authorization": f"Bearer {token}"},
        params={"event_id": str(event.id), **params},
    )


def test_admin_rosters_filter_by_date_and_preserve_unscoped_listing(
    client, series, admin_token_tenant_a
):
    event, _, start = series
    for params, expected in [
        ({}, 4),
        ({"occurrence_start": start.isoformat()}, 1),
        ({"occurrence_start": (start + timedelta(days=1)).isoformat()}, 3),
        ({"occurrence_start": (start + timedelta(days=2)).isoformat()}, 0),
    ]:
        response = roster(client, event, admin_token_tenant_a, **params)
        assert response.status_code == 200, response.text
        assert response.json()["paging"]["total"] == expected
        assert len(response.json()["results"]) == expected


def test_occurrence_roster_pagination_and_offset_normalization(
    client, series, admin_token_tenant_a
):
    event, _, _ = series
    params = {"occurrence_start": "2031-03-04T15:30:00+05:30", "limit": 2}
    first = roster(client, event, admin_token_tenant_a, **params).json()
    second = roster(client, event, admin_token_tenant_a, skip=2, **params).json()
    assert first["paging"]["total"] == second["paging"]["total"] == 3
    assert len(first["results"]) == 2
    assert len(second["results"]) == 1
    assert not {p["id"] for p in first["results"]} & {
        p["id"] for p in second["results"]
    }


def test_host_exclusion_is_only_applied_to_explicit_occurrence_reads(
    client, db, series, admin_token_tenant_a
):
    event, humans, start = series
    event.host_id = humans[0].id
    db.add(event)
    db.commit()
    selected = roster(
        client,
        event,
        admin_token_tenant_a,
        occurrence_start=(start + timedelta(days=1)).isoformat(),
    ).json()
    assert {p["profile_id"] for p in selected["results"]} == {
        str(humans[1].id),
        str(humans[2].id),
    }
    # Default administrative listing is intentionally unchanged.
    assert roster(client, event, admin_token_tenant_a).json()["paging"]["total"] == 4


def test_detached_roster_can_explicitly_select_null_without_remapping_rows(
    client, db, series, admin_token_tenant_a
):
    master, humans, start = series
    child = Events(
        tenant_id=master.tenant_id,
        popup_id=master.popup_id,
        owner_id=master.owner_id,
        host_id=humans[0].id,
        recurrence_master_id=master.id,
        title="Detached",
        start_time=start,
        end_time=start + timedelta(hours=1),
    )
    db.add(child)
    db.flush()
    rows = [
        EventParticipants(
            tenant_id=master.tenant_id,
            event_id=child.id,
            profile_id=person.id,
            occurrence_start=occ,
        )
        for person, occ in [(humans[0], None), (humans[1], None), (humans[2], start)]
    ]
    db.add_all(rows)
    db.commit()
    response = roster(client, child, admin_token_tenant_a, scope_to_occurrence=True)
    assert response.status_code == 200, response.text
    assert [p["profile_id"] for p in response.json()["results"]] == [str(humans[1].id)]
    assert roster(client, child, admin_token_tenant_a).json()["paging"]["total"] == 3
    db.expire_all()
    assert [db.get(EventParticipants, row.id).occurrence_start for row in rows] == [
        None,
        None,
        start,
    ]


def test_read_filters_do_not_resolve_or_rewrite_event_details(
    client, series, admin_token_tenant_a
):
    event, _, start = series
    headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}
    before = client.get(f"/api/v1/events/{event.id}", headers=headers).json()
    roster(
        client,
        event,
        admin_token_tenant_a,
        occurrence_start=(start + timedelta(days=1)).isoformat(),
    )
    after = client.get(f"/api/v1/events/{event.id}", headers=headers).json()
    assert after == before
    assert datetime.fromisoformat(after["start_time"]) == start
    assert "resolved_occurrence_start" not in after
    # The existing list still uses its series-wide RSVP counter.
    events = client.get(
        "/api/v1/events",
        headers=headers,
        params={
            "popup_id": str(event.popup_id),
            "start_after": start.isoformat(),
            "start_before": (start + timedelta(days=3)).isoformat(),
        },
    ).json()["results"]
    assert [row["attendee_count"] for row in events] == [3, 3, 3]


def test_occurrence_filter_requires_event_and_timezone(
    client, series, admin_token_tenant_a
):
    event, _, _ = series
    headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}
    assert (
        client.get(
            "/api/v1/event-participants",
            headers=headers,
            params={"scope_to_occurrence": True},
        ).status_code
        == 400
    )
    assert (
        roster(
            client, event, admin_token_tenant_a, occurrence_start="2031-03-04T10:00:00"
        ).status_code
        == 400
    )
    assert (
        client.get(
            "/api/v1/event-participants",
            headers=headers,
            params={"event_id": str(uuid.uuid4()), "scope_to_occurrence": True},
        ).status_code
        == 404
    )


def test_scoped_rosters_keep_administrative_access_controls(
    client,
    series,
    admin_token_tenant_a,
    admin_token_tenant_b,
    viewer_token_tenant_a,
    admin_api_key_factory,
):
    event, _, start = series
    params = {"occurrence_start": start.isoformat()}
    assert roster(client, event, admin_token_tenant_a, **params).status_code == 200
    assert roster(client, event, admin_token_tenant_b, **params).status_code == 404
    assert roster(client, event, viewer_token_tenant_a, **params).status_code == 403
    for scopes, expected in [(["events:read"], 200), (["venues:read"], 403)]:
        _, raw = admin_api_key_factory(scopes=scopes)
        assert roster(client, event, raw, **params).status_code == expected
