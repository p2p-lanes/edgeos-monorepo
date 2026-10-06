"""The read-only series view starts from the calendar, never from RSVP rows."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlmodel import select

from app.api.event.models import Events
from app.api.event_participant.models import EventParticipants
from app.api.popup.models import Popups
from app.core.security import create_access_token
from tests.test_event_occurrence_context import series as _series_fixture


@pytest.fixture
def series(db, tenant_a):
    fixture = _series_fixture.__wrapped__(db, tenant_a)
    event, _, start = fixture
    popup = db.get(Popups, event.popup_id)
    popup.start_date = start.replace(hour=0, tzinfo=None)
    popup.end_date = (start + timedelta(days=2)).replace(hour=0, tzinfo=None)
    db.add(popup)
    db.commit()
    return fixture


def summary(client, event_id, token, **params):
    return client.get(
        f"/api/v1/events/{event_id}/series-summary",
        headers={"Authorization": f"Bearer {token}"},
        params=params,
    )


def test_calendar_contains_zero_rsvp_dates(client, series, admin_token_tenant_a):
    event, _, start = series
    response = summary(client, event.id, admin_token_tenant_a)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["series_id"] == str(event.id)
    assert [row["attendee_count"] for row in body["occurrences"]] == [1, 2, 0]
    assert [
        datetime.fromisoformat(row["occurrence_start"]) for row in body["occurrences"]
    ] == [start + timedelta(days=d) for d in range(3)]


def test_hosts_and_cancelled_do_not_count(client, db, series, admin_token_tenant_a):
    event, humans, _ = series
    event.host_id = humans[0].id
    db.add(event)
    db.commit()
    body = summary(client, event.id, admin_token_tenant_a).json()
    assert [row["attendee_count"] for row in body["occurrences"]] == [0, 1, 0]


def test_detached_child_owns_its_date_and_counts(
    client, db, series, admin_token_tenant_a
):
    master, humans, start = series
    removed = start + timedelta(days=2)
    master.recurrence_exdates = [removed.isoformat()]
    child = Events(
        tenant_id=master.tenant_id,
        popup_id=master.popup_id,
        owner_id=master.owner_id,
        recurrence_master_id=master.id,
        title="Moved class",
        start_time=removed + timedelta(hours=2),
        end_time=removed + timedelta(hours=3),
        timezone="UTC",
    )
    db.add(master)
    db.add(child)
    db.flush()
    db.add(
        EventParticipants(
            tenant_id=master.tenant_id, event_id=child.id, profile_id=humans[1].id
        )
    )
    db.commit()
    for event_id in [master.id, child.id]:
        response = summary(client, event_id, admin_token_tenant_a)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["series_id"] == str(master.id)
        assert len(body["occurrences"]) == 3
        row = body["occurrences"][-1]
        assert row["event_id"] == str(child.id)
        assert row["is_detached"]
        assert row["occurrence_start"] is None
        assert datetime.fromisoformat(row["start_time"]) == child.start_time
        assert row["attendee_count"] == 1


def test_gathering_dates_bound_unending_series_and_include_empty_dates(
    client, db, series, admin_token_tenant_a
):
    event, _, start = series
    event.rrule = "FREQ=DAILY"
    popup = db.get(Popups, event.popup_id)
    popup.start_date = start.replace(hour=0, tzinfo=None)
    popup.end_date = (start + timedelta(days=5)).replace(hour=0, tzinfo=None)
    db.add_all([event, popup])
    db.commit()
    body = summary(client, event.id, admin_token_tenant_a).json()
    assert len(body["occurrences"]) == 6
    assert [row["attendee_count"] for row in body["occurrences"]] == [1, 2, 0, 0, 0, 0]


def test_calendar_is_not_truncated_at_default_expansion_cap(
    client, db, series, admin_token_tenant_a
):
    event, _, start = series
    event.rrule = "FREQ=DAILY;COUNT=150"
    popup = db.get(Popups, event.popup_id)
    popup.start_date = start.replace(hour=0, tzinfo=None)
    popup.end_date = (start + timedelta(days=149)).replace(hour=0, tzinfo=None)
    db.add_all([event, popup])
    db.commit()
    body = summary(client, event.id, admin_token_tenant_a).json()
    assert len(body["occurrences"]) == 150
    assert body["occurrences"][-1]["attendee_count"] == 0


def test_full_gathering_over_one_year_is_not_truncated(
    client, db, series, admin_token_tenant_a
):
    event, _, start = series
    event.rrule = "FREQ=DAILY"
    popup = db.get(Popups, event.popup_id)
    popup.end_date = (start + timedelta(days=1099)).replace(hour=0, tzinfo=None)
    db.add_all([event, popup])
    db.commit()
    response = summary(client, event.id, admin_token_tenant_a)
    assert response.status_code == 200, response.text
    rows = response.json()["occurrences"]
    assert len(rows) == 1100
    assert len({row["occurrence_start"] for row in rows}) == 1100
    assert datetime.fromisoformat(rows[-1]["start_time"]) == start + timedelta(
        days=1099
    )
    assert rows[-1]["attendee_count"] == 0


@pytest.mark.parametrize("missing", ["start", "end", "both"])
def test_missing_gathering_dates_do_not_invent_a_different_range(
    client, db, series, admin_token_tenant_a, missing
):
    event, _, _ = series
    popup = db.get(Popups, event.popup_id)
    if missing in {"start", "both"}:
        popup.start_date = None
    if missing in {"end", "both"}:
        popup.end_date = None
    db.add(popup)
    db.commit()
    response = summary(client, event.id, admin_token_tenant_a)
    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Set gathering start and end dates to view other occurrences."
    )


def test_invalid_gathering_range_is_a_controlled_error(
    client, db, series, admin_token_tenant_a
):
    event, _, start = series
    popup = db.get(Popups, event.popup_id)
    popup.end_date = (start - timedelta(days=1)).replace(hour=0, tzinfo=None)
    db.add(popup)
    db.commit()
    response = summary(client, event.id, admin_token_tenant_a)
    assert response.status_code == 400
    assert response.json()["detail"] == "The gathering has an invalid date range"


def test_dst_occurrences_use_local_wall_clock(client, db, series, admin_token_tenant_a):
    event, _, _ = series
    event.start_time = datetime(2031, 3, 7, 23, tzinfo=UTC)
    event.end_time = event.start_time + timedelta(hours=1)
    event.rrule = "FREQ=DAILY;COUNT=4"
    event.timezone = "America/New_York"
    popup = db.get(Popups, event.popup_id)
    popup.start_date = event.start_time.replace(hour=0, tzinfo=None)
    popup.end_date = (event.start_time + timedelta(days=3)).replace(hour=0, tzinfo=None)
    db.add_all([event, popup])
    db.commit()
    rows = summary(client, event.id, admin_token_tenant_a).json()["occurrences"]
    assert [datetime.fromisoformat(row["start_time"]).hour for row in rows] == [
        23,
        23,
        22,
        22,
    ]


def test_access_requires_admin_and_same_tenant(
    client, series, admin_token_tenant_a, admin_token_tenant_b, viewer_token_tenant_a
):
    event, humans, _ = series
    assert summary(client, event.id, admin_token_tenant_b).status_code == 404
    assert summary(client, event.id, viewer_token_tenant_a).status_code == 403
    human_token = create_access_token(subject=humans[0].id, token_type="human")
    assert summary(client, event.id, human_token).status_code in {401, 403}
    assert summary(client, uuid.uuid4(), admin_token_tenant_a).status_code == 404


def test_admin_api_key_requires_events_read(client, series, admin_api_key_factory):
    event, _, _ = series
    for scopes, expected in [(["events:read"], 200), (["venues:read"], 403)]:
        _, raw = admin_api_key_factory(scopes=scopes)
        assert summary(client, event.id, raw).status_code == expected


def test_portal_api_key_cannot_read_administrative_rosters(
    client, db, series, admin_api_key_factory
):
    event, humans, _ = series
    human_id, popup_id, event_id = humans[0].id, event.popup_id, event.id
    key, raw = admin_api_key_factory(scopes=["events:read"])
    key.user_id = None
    key.human_id = human_id
    key.popup_id = popup_id
    db.add(key)
    db.commit()
    assert summary(client, event_id, raw).status_code == 403


@pytest.mark.parametrize(
    "rule, timezone",
    [
        ("FREQ=YEARLY", "UTC"),
        ("FREQ=DAILY;COUNT=0", "UTC"),
        ("FREQ=DAILY;COUNT=3", "Not/AZone"),
    ],
)
def test_invalid_legacy_schedule_is_a_controlled_error(
    client, db, series, admin_token_tenant_a, rule, timezone
):
    event, _, _ = series
    event.rrule = rule
    event.timezone = timezone
    db.add(event)
    db.commit()
    assert summary(client, event.id, admin_token_tenant_a).status_code == 400


def test_oneoff_without_series_is_rejected(client, db, series, admin_token_tenant_a):
    event, _, _ = series
    event.rrule = None
    db.add(event)
    db.commit()
    assert summary(client, event.id, admin_token_tenant_a).status_code == 400


def test_child_in_another_gathering_is_not_part_of_the_view(
    client, db, series, popup_tenant_a, admin_token_tenant_a
):
    master, _, start = series
    child = Events(
        tenant_id=master.tenant_id,
        popup_id=popup_tenant_a.id,
        owner_id=master.owner_id,
        recurrence_master_id=master.id,
        title="Unrelated gathering",
        start_time=start,
        end_time=start + timedelta(hours=1),
    )
    db.add(child)
    db.commit()
    assert summary(client, child.id, admin_token_tenant_a).status_code == 404
    rows = summary(client, master.id, admin_token_tenant_a).json()["occurrences"]
    assert all(row["event_id"] != str(child.id) for row in rows)


def test_summary_only_projects_scheduled_rows_and_does_not_modify_registrations(
    client, db, series, admin_token_tenant_a
):
    event, humans, start = series
    event.recurrence_exdates = [start.isoformat()]
    db.add(event)
    db.add_all(
        [
            EventParticipants(
                tenant_id=event.tenant_id,
                event_id=event.id,
                profile_id=humans[1].id,
                occurrence_start=None,
            ),
            EventParticipants(
                tenant_id=event.tenant_id,
                event_id=event.id,
                profile_id=humans[1].id,
                occurrence_start=start - timedelta(days=1),
            ),
        ]
    )
    db.commit()

    def snapshot():
        return sorted(
            (str(row.id), row.occurrence_start, row.status, row.updated_at)
            for row in db.exec(
                select(EventParticipants).where(EventParticipants.event_id == event.id)
            ).all()
        )

    before = snapshot()
    response = summary(client, event.id, admin_token_tenant_a)
    assert response.status_code == 200, response.text
    body = response.json()
    assert [row["attendee_count"] for row in body["occurrences"]] == [2, 0]
    assert "outside_schedule" not in body
    db.expire_all()
    assert snapshot() == before
    assert db.get(Events, event.id).start_time == start
    assert db.get(Events, event.id).recurrence_exdates == [start.isoformat()]
