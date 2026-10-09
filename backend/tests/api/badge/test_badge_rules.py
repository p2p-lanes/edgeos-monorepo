"""SIM-108: badges awarded automatically from attending and hosting."""

import uuid
from datetime import UTC, date, datetime, time, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.badge.models import BadgeAwards
from app.api.badge.rules import longest_streak, qualified_humans, sweep_badge_rules
from app.api.badge.schemas import BadgeRuleConfig
from app.api.event.models import Events
from app.api.event.schemas import EventStatus
from app.api.event_participant.models import EventCheckIns, EventParticipants
from app.api.event_participant.schemas import (
    CheckInMethod,
    ParticipantRole,
    ParticipantStatus,
)
from app.api.event_settings.models import EventSettings
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.track.models import Tracks
from tests.test_event_qr_check_in import (
    _check_in,
    _give_ticket,
    _make_event,
    _make_human,
)
from tests.test_event_qr_check_in import _make_popup as _make_plain_popup

BADGES = "/api/v1/badges"
RULES = "/api/v1/badge-rules"
SETTLED = timedelta(hours=3)


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    """A popup with badges on: only those count toward rules."""
    popup = _make_plain_popup(db, tenant)
    popup.badges_enabled = True
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


@pytest.fixture(scope="module")
def admin(admin_token_tenant_a: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {admin_token_tenant_a}"}


@pytest.fixture(scope="module")
def style(client: TestClient, admin) -> dict:
    resp = client.post(
        "/api/v1/badge-styles",
        json={"name": f"Rules {uuid.uuid4().hex[:6]}"},
        headers=admin,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _badge(client: TestClient, admin, style, **overrides) -> dict:
    body = {
        "name": f"Sauna {uuid.uuid4().hex[:6]}",
        "images": [{"style_id": style["id"], "image_url": "https://cdn.test/s.webp"}],
    }
    body.update(overrides)
    resp = client.post(BADGES, json=body, headers=admin)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _rule(client: TestClient, admin, badge, *conditions: dict, **extra) -> dict:
    resp = client.post(
        RULES,
        json={
            "badge_id": badge["id"],
            "config": {"conditions": list(conditions)},
            **extra,
        },
        headers=admin,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _track(db: Session, tenant: Tenants, popup: Popups, name="Sauna") -> Tracks:
    track = Tracks(tenant_id=tenant.id, popup_id=popup.id, name=name)
    db.add(track)
    db.commit()
    db.refresh(track)
    return track


def _past_event(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    start: datetime,
    *,
    duration=timedelta(hours=1),
    **fields,
) -> Events:
    event = _make_event(db, tenant, popup, duration=duration)
    event.start_time = start
    event.end_time = start + duration
    for key, value in fields.items():
        setattr(event, key, value)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _mark(
    db: Session,
    tenant: Tenants,
    human: Humans,
    event: Events,
    *,
    occurrence_start: datetime | None = None,
    voided: bool = False,
    role: ParticipantRole = ParticipantRole.ATTENDEE,
) -> None:
    """Attendance as the roll call leaves it, without the time window."""
    participant = EventParticipants(
        tenant_id=tenant.id,
        event_id=event.id,
        profile_id=human.id,
        status=ParticipantStatus.CHECKED_IN,
        role=role,
        occurrence_start=occurrence_start,
    )
    db.add(participant)
    db.commit()
    db.refresh(participant)
    if role != ParticipantRole.ATTENDEE:
        return
    db.add(
        EventCheckIns(
            tenant_id=tenant.id,
            event_id=event.id,
            participant_id=participant.id,
            profile_id=human.id,
            occurrence_start=occurrence_start,
            method=CheckInMethod.MANUAL,
            voided_at=datetime.now(UTC) if voided else None,
        )
    )
    db.commit()


def _awards(db: Session, badge_id: str, human_id: uuid.UUID) -> list[BadgeAwards]:
    db.expire_all()
    return list(
        db.exec(
            select(BadgeAwards).where(
                BadgeAwards.badge_id == uuid.UUID(badge_id),
                BadgeAwards.recipient_human_id == human_id,
            )
        ).all()
    )


def _qualifies(db: Session, tenant: Tenants, human: Humans, *conditions: dict) -> bool:
    config = BadgeRuleConfig.model_validate({"conditions": list(conditions)})
    return human.id in qualified_humans(db, tenant.id, config, {human.id})


def _days_ago(days: int, hour: int = 10) -> datetime:
    today = datetime.now(UTC).replace(hour=hour, minute=0, second=0, microsecond=0)
    return today - timedelta(days=days)


# ---------------------------------------------------------------------------
# Timing: only settled attendance counts
# ---------------------------------------------------------------------------


def test_badge_waits_until_the_check_in_can_no_longer_be_voided(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    popup = _make_popup(db, tenant_a)
    track = _track(db, tenant_a, popup)
    event = _make_event(db, tenant_a, popup)
    event.track_id = track.id
    db.add(event)
    db.commit()
    badge = _badge(client, admin, style)
    _rule(
        client,
        admin,
        badge,
        {"threshold": 1, "filters": {"track_ids": [str(track.id)]}},
    )
    human = _make_human(db, tenant_a)
    _give_ticket(db, tenant_a, popup, human)

    # The check-in itself never awards: it can still be voided.
    assert _check_in(client, human, event).status_code == 200
    assert _awards(db, badge["id"], human.id) == []
    sweep_badge_rules(db)
    assert _awards(db, badge["id"], human.id) == []

    # Once the void window has closed, the sweep gives it, exactly once.
    later = event.end_time.replace(tzinfo=UTC) + timedelta(minutes=121)
    assert sweep_badge_rules(db, now=later)["awarded"] >= 1
    [award] = _awards(db, badge["id"], human.id)
    assert award.issuer_type == "rule"
    assert sweep_badge_rules(db, now=later)["awarded"] == 0


def test_voided_check_ins_never_count(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    popup = _make_popup(db, tenant_a)
    events = [_past_event(db, tenant_a, popup, _days_ago(d)) for d in (3, 2)]
    regular, voided = _make_human(db, tenant_a), _make_human(db, tenant_a)
    for event in events:
        _mark(db, tenant_a, regular, event)
    _mark(db, tenant_a, voided, events[0], voided=True)
    _mark(db, tenant_a, voided, events[1])

    badge = _badge(client, admin, style)
    rule = _rule(
        client, admin, badge, {"threshold": 2, "filters": {"popup_id": str(popup.id)}}
    )
    assert rule["award_count"] == 1
    assert len(_awards(db, badge["id"], regular.id)) == 1
    assert _awards(db, badge["id"], voided.id) == []


def test_popups_with_badges_off_never_count(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    on, off = _make_popup(db, tenant_a), _make_plain_popup(db, tenant_a)
    human = _make_human(db, tenant_a)
    _mark(db, tenant_a, human, _past_event(db, tenant_a, on, _days_ago(3)))
    _mark(db, tenant_a, human, _past_event(db, tenant_a, off, _days_ago(2)))

    # A rule over every popup only sees the one with badges on.
    assert _qualifies(db, tenant_a, human, {"threshold": 1})
    assert not _qualifies(db, tenant_a, human, {"threshold": 2})

    # Naming a popup with badges off is refused outright.
    badge = _badge(client, admin, style)
    resp = client.post(
        RULES,
        json={
            "badge_id": badge["id"],
            "config": {
                "conditions": [{"threshold": 1, "filters": {"popup_id": str(off.id)}}]
            },
        },
        headers=admin,
    )
    assert resp.status_code == 409, resp.text

    # One already naming it (badges turned off later) can still be edited.
    rule = _rule(
        client, admin, badge, {"threshold": 1, "filters": {"popup_id": str(on.id)}}
    )
    on.badges_enabled = False
    db.add(on)
    db.commit()
    resp = client.patch(
        f"{RULES}/{rule['id']}",
        json={
            "config": {
                "conditions": [{"threshold": 2, "filters": {"popup_id": str(on.id)}}]
            }
        },
        headers=admin,
    )
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------


def test_tags_match_any_or_all_ignoring_case(db: Session, tenant_a: Tenants):
    popup = _make_popup(db, tenant_a)
    human = _make_human(db, tenant_a)
    for days, tags in ((4, ["Wellness", "sauna"]), (3, [" wellness "]), (2, ["Yoga"])):
        _mark(
            db,
            tenant_a,
            human,
            _past_event(db, tenant_a, popup, _days_ago(days), tags=tags),
        )
    scope = {"popup_id": str(popup.id)}

    def tags(threshold: int, values: list[str], match: str = "any") -> bool:
        return _qualifies(
            db,
            tenant_a,
            human,
            {
                "threshold": threshold,
                "filters": {**scope, "tags": values, "tags_match": match},
            },
        )

    assert tags(2, ["WELLNESS"])
    assert not tags(3, ["wellness"])
    assert tags(3, ["wellness", "yoga"])
    assert tags(1, ["wellness", "SAUNA"], "all")
    assert not tags(2, ["wellness", "sauna"], "all")


def test_kinds_venues_and_events_filters(db: Session, tenant_a: Tenants):
    popup = _make_popup(db, tenant_a)
    human = _make_human(db, tenant_a)
    talk = _past_event(db, tenant_a, popup, _days_ago(3), kind="Talk")
    workshop = _past_event(db, tenant_a, popup, _days_ago(2), kind="workshop")
    for event in (talk, workshop):
        _mark(db, tenant_a, human, event)

    def count(threshold: int, **filters) -> bool:
        return _qualifies(
            db,
            tenant_a,
            human,
            {"threshold": threshold, "filters": {"popup_id": str(popup.id), **filters}},
        )

    assert count(1, kinds=["talk"]) and not count(2, kinds=["TALK"])
    assert count(2, kinds=["talk", "Workshop"])
    assert count(1, event_ids=[str(workshop.id)])
    assert not count(2, event_ids=[str(workshop.id)])


def test_weekday_time_and_date_filters_use_the_popup_timezone(
    db: Session, tenant_a: Tenants
):
    popup = _make_popup(db, tenant_a)
    db.add(
        EventSettings(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            timezone="America/Argentina/Buenos_Aires",  # UTC-3, no DST
        )
    )
    db.commit()
    human = _make_human(db, tenant_a)
    # Tue 2026-03-03 02:00 UTC is Monday 23:00 in Buenos Aires.
    late_monday = datetime(2026, 3, 3, 2, 0, tzinfo=UTC)
    # Wed 2026-03-04 10:00 UTC is Wednesday 07:00 local.
    early_wednesday = datetime(2026, 3, 4, 10, 0, tzinfo=UTC)
    for start in (late_monday, early_wednesday):
        _mark(db, tenant_a, human, _past_event(db, tenant_a, popup, start))

    def count(threshold: int, **filters) -> bool:
        return _qualifies(
            db,
            tenant_a,
            human,
            {"threshold": threshold, "filters": {"popup_id": str(popup.id), **filters}},
        )

    assert count(1, weekdays=[1]) and not count(2, weekdays=[1, 2])
    assert count(2, weekdays=[1, 3])
    assert count(1, starts_before="08:00") and not count(2, starts_before="08:00")
    assert count(1, starts_after="22:00")
    assert count(1, date_from="2026-03-04") and not count(2, date_from="2026-03-04")
    assert count(1, date_to="2026-03-02")


# ---------------------------------------------------------------------------
# Measures
# ---------------------------------------------------------------------------


def test_longest_streak():
    d = date(2026, 3, 1)
    assert longest_streak(set()) == 0
    days = {d, d + timedelta(1), d + timedelta(2), d + timedelta(5), d + timedelta(6)}
    assert longest_streak(days) == 3


def test_count_distinct_days_and_streak(db: Session, tenant_a: Tenants):
    popup = _make_popup(db, tenant_a)
    human = _make_human(db, tenant_a)
    # Days ago 6, 5, 4 (twice) and 2: five occurrences, four days, streak 3.
    for days, hour in ((6, 9), (5, 9), (4, 9), (4, 15), (2, 9)):
        _mark(
            db, tenant_a, human, _past_event(db, tenant_a, popup, _days_ago(days, hour))
        )

    def measure(name: str, threshold: int) -> bool:
        return _qualifies(
            db,
            tenant_a,
            human,
            {
                "measure": name,
                "threshold": threshold,
                "filters": {"popup_id": str(popup.id)},
            },
        )

    assert measure("count", 5) and not measure("count", 6)
    assert measure("distinct_days", 4) and not measure("distinct_days", 5)
    assert measure("streak_days", 3) and not measure("streak_days", 4)


def test_recurring_check_ins_count_per_occurrence(db: Session, tenant_a: Tenants):
    popup = _make_popup(db, tenant_a)
    human = _make_human(db, tenant_a)
    first = _days_ago(5)
    series = _past_event(
        db, tenant_a, popup, first, rrule="FREQ=DAILY;INTERVAL=1;COUNT=3"
    )
    for offset in range(3):
        _mark(
            db,
            tenant_a,
            human,
            series,
            occurrence_start=first + timedelta(days=offset),
        )
    assert _qualifies(
        db,
        tenant_a,
        human,
        {
            "measure": "streak_days",
            "threshold": 3,
            "filters": {"popup_id": str(popup.id)},
        },
    )


# ---------------------------------------------------------------------------
# Hosting
# ---------------------------------------------------------------------------


def test_hosting_counts_owners_hosts_collaborators_and_speakers(
    db: Session, tenant_a: Tenants
):
    popup = _make_popup(db, tenant_a)
    human = _make_human(db, tenant_a)
    _past_event(db, tenant_a, popup, _days_ago(9), owner_id=human.id)
    _past_event(db, tenant_a, popup, _days_ago(8), host_id=human.id)
    _past_event(db, tenant_a, popup, _days_ago(7), collaborator_ids=[human.id])
    talk = _past_event(db, tenant_a, popup, _days_ago(6))
    _mark(db, tenant_a, human, talk, role=ParticipantRole.SPEAKER)
    # A whole series the person owns: three past occurrences.
    _past_event(
        db,
        tenant_a,
        popup,
        _days_ago(5),
        owner_id=human.id,
        rrule="FREQ=DAILY;INTERVAL=1;COUNT=3",
    )
    # Neither a draft nor an event still in progress counts.
    _past_event(
        db, tenant_a, popup, _days_ago(1), owner_id=human.id, status=EventStatus.DRAFT
    )
    _make_event(db, tenant_a, popup, owner_id=human.id)

    def hosted(threshold: int) -> bool:
        return _qualifies(
            db,
            tenant_a,
            human,
            {
                "activity": "host",
                "threshold": threshold,
                "filters": {"popup_id": str(popup.id)},
            },
        )

    assert hosted(7) and not hosted(8)


# ---------------------------------------------------------------------------
# Several conditions
# ---------------------------------------------------------------------------


def test_every_condition_must_hold(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    popup = _make_popup(db, tenant_a)
    sauna, workout = _track(db, tenant_a, popup), _track(db, tenant_a, popup, "Gym")
    sauna_event = _past_event(db, tenant_a, popup, _days_ago(3), track_id=sauna.id)
    gym_event = _past_event(db, tenant_a, popup, _days_ago(2), track_id=workout.id)
    both, only_sauna = _make_human(db, tenant_a), _make_human(db, tenant_a)
    _mark(db, tenant_a, both, sauna_event)
    _mark(db, tenant_a, both, gym_event)
    _mark(db, tenant_a, only_sauna, sauna_event)

    badge = _badge(client, admin, style)
    preview = client.post(
        f"{RULES}/preview",
        json={
            "badge_id": badge["id"],
            "config": {
                "conditions": [
                    {"threshold": 1, "filters": {"track_ids": [str(sauna.id)]}},
                    {"threshold": 1, "filters": {"track_ids": [str(workout.id)]}},
                ]
            },
        },
        headers=admin,
    )
    assert preview.status_code == 200, preview.text
    assert preview.json() == {"qualified": 1, "new_recipients": 1}

    rule = _rule(
        client,
        admin,
        badge,
        {"threshold": 1, "filters": {"track_ids": [str(sauna.id)]}},
        {"threshold": 1, "filters": {"track_ids": [str(workout.id)]}},
    )
    assert rule["award_count"] == 1
    assert len(_awards(db, badge["id"], both.id)) == 1
    assert _awards(db, badge["id"], only_sauna.id) == []


# ---------------------------------------------------------------------------
# Lifecycle and validation
# ---------------------------------------------------------------------------


def test_admin_revoke_is_not_undone_by_the_rule(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    popup = _make_popup(db, tenant_a)
    human = _make_human(db, tenant_a)
    _mark(db, tenant_a, human, _past_event(db, tenant_a, popup, _days_ago(2)))
    badge = _badge(client, admin, style, repeatable=True)
    rule = _rule(
        client, admin, badge, {"threshold": 1, "filters": {"popup_id": str(popup.id)}}
    )
    [award] = _awards(db, badge["id"], human.id)

    revoke = client.post(
        f"{BADGES}/awards/{award.id}/revoke", json={"reason": "Test"}, headers=admin
    )
    assert revoke.status_code == 200
    resp = client.post(f"{RULES}/{rule['id']}/evaluate", headers=admin)
    assert resp.json()["awarded"] == 0
    assert len(_awards(db, badge["id"], human.id)) == 1


def test_paused_rule_does_nothing(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    popup = _make_popup(db, tenant_a)
    human = _make_human(db, tenant_a)
    _mark(db, tenant_a, human, _past_event(db, tenant_a, popup, _days_ago(2)))
    badge = _badge(client, admin, style)
    rule = _rule(
        client,
        admin,
        badge,
        {"threshold": 1, "filters": {"popup_id": str(popup.id)}},
        is_active=False,
    )
    sweep_badge_rules(db)
    assert _awards(db, badge["id"], human.id) == []

    resp = client.patch(
        f"{RULES}/{rule['id']}", json={"is_active": True}, headers=admin
    )
    assert resp.status_code == 200
    evaluated = client.post(f"{RULES}/{rule['id']}/evaluate", headers=admin)
    assert evaluated.json()["awarded"] == 1


def test_rule_validation(client: TestClient, admin, style):
    badge = _badge(client, admin, style)

    def create(config: dict) -> int:
        return client.post(
            RULES, json={"badge_id": badge["id"], "config": config}, headers=admin
        ).status_code

    assert create({"conditions": []}) == 422
    assert (
        create(
            {
                "conditions": [
                    {"threshold": 1, "filters": {"track_ids": [str(uuid.uuid4())]}}
                ]
            }
        )
        == 404
    )
    assert (
        create(
            {
                "conditions": [
                    {
                        "threshold": 1,
                        "filters": {"starts_after": "10:00", "starts_before": "09:00"},
                    }
                ]
            }
        )
        == 422
    )
    assert (
        create({"conditions": [{"threshold": 1, "filters": {"weekdays": [8]}}]}) == 422
    )
    assert create({"conditions": [{"threshold": 0}]}) == 422


def test_filters_are_normalized(client: TestClient, admin, style):
    badge = _badge(client, admin, style)
    rule = _rule(
        client,
        admin,
        badge,
        {
            "threshold": 2,
            "filters": {
                "tags": [" Wellness", "wellness", ""],
                "weekdays": [3, 1, 3],
                "starts_before": "08:00",
            },
        },
        evaluate_now=False,
    )
    [condition] = rule["config"]["conditions"]
    assert condition["activity"] == "attend" and condition["measure"] == "count"
    assert condition["filters"]["tags"] == ["Wellness"]
    assert condition["filters"]["weekdays"] == [1, 3]
    assert condition["filters"]["starts_before"] == time(8).isoformat()


def test_options_merge_curated_and_used_values(
    client: TestClient, db: Session, tenant_a: Tenants, admin
):
    popup = _make_popup(db, tenant_a)
    db.add(
        EventSettings(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            allowed_tags=["Wellness", "Music"],
            allowed_kinds=["Talk"],
        )
    )
    db.commit()
    _past_event(
        db, tenant_a, popup, _days_ago(1), tags=["wellness", "Yoga"], kind="talk"
    )
    _past_event(db, tenant_a, popup, _days_ago(1), kind="Workshop")

    resp = client.get(
        f"{RULES}/options", params={"popup_id": str(popup.id)}, headers=admin
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "tags": ["Music", "Wellness", "Yoga"],
        "kinds": ["Talk", "Workshop"],
    }


# ---------------------------------------------------------------------------
# Setting a badge up in one go
# ---------------------------------------------------------------------------


def test_badge_is_created_with_its_policies_and_rules(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    popup = _make_popup(db, tenant_a)
    regular, giver = _make_human(db, tenant_a), _make_human(db, tenant_a)
    _mark(db, tenant_a, regular, _past_event(db, tenant_a, popup, _days_ago(2)))
    sibling = _badge(client, admin, style)

    resp = client.post(
        BADGES,
        json={
            "name": f"Regular {uuid.uuid4().hex[:6]}",
            "images": [
                {"style_id": style["id"], "image_url": "https://cdn.test/r.webp"}
            ],
            "issuer_policies": [
                {
                    "name": "Hosts",
                    "audience_type": "humans",
                    "human_ids": [str(giver.id)],
                    "badge_ids": [sibling["id"]],
                    "allowance_quantity": 2,
                    "allowance_window": "day",
                }
            ],
            "rules": [
                {
                    "config": {
                        "conditions": [
                            {"threshold": 1, "filters": {"popup_id": str(popup.id)}}
                        ]
                    }
                }
            ],
        },
        headers=admin,
    )
    assert resp.status_code == 201, resp.text
    badge = resp.json()
    # The rule ran right away for people who already qualify.
    assert badge["award_count"] == 1
    assert len(_awards(db, badge["id"], regular.id)) == 1

    [rule] = client.get(RULES, params={"badge_id": badge["id"]}, headers=admin).json()
    assert rule["award_count"] == 1
    [policy] = client.get(
        "/api/v1/badge-issuer-policies",
        params={"badge_id": badge["id"]},
        headers=admin,
    ).json()
    assert [b["id"] for b in policy["badges"]] == [badge["id"], sibling["id"]]
    assert [h["id"] for h in policy["humans"]] == [str(giver.id)]


def test_badge_create_is_all_or_nothing(client: TestClient, admin, style):
    name = f"Broken {uuid.uuid4().hex[:6]}"
    resp = client.post(
        BADGES,
        json={
            "name": name,
            "images": [
                {"style_id": style["id"], "image_url": "https://cdn.test/b.webp"}
            ],
            "rules": [
                {
                    "config": {
                        "conditions": [
                            {
                                "threshold": 1,
                                "filters": {"track_ids": [str(uuid.uuid4())]},
                            }
                        ]
                    }
                }
            ],
        },
        headers=admin,
    )
    assert resp.status_code == 404
    listed = client.get(BADGES, params={"limit": 500}, headers=admin).json()
    assert name not in {b["name"] for b in listed["results"]}

    # A policy without the badge needs nothing else to point at.
    bad_policy = client.post(
        BADGES,
        json={
            "name": name,
            "images": [
                {"style_id": style["id"], "image_url": "https://cdn.test/b.webp"}
            ],
            "issuer_policies": [
                {"name": "Attendees", "audience_type": "popup_attendees"}
            ],
        },
        headers=admin,
    )
    assert bad_policy.status_code == 422


def test_preview_works_before_the_badge_exists(
    client: TestClient, db: Session, tenant_a: Tenants, admin
):
    popup = _make_popup(db, tenant_a)
    human = _make_human(db, tenant_a)
    _mark(db, tenant_a, human, _past_event(db, tenant_a, popup, _days_ago(2)))
    resp = client.post(
        f"{RULES}/preview",
        json={
            "config": {
                "conditions": [{"threshold": 1, "filters": {"popup_id": str(popup.id)}}]
            }
        },
        headers=admin,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"qualified": 1, "new_recipients": 1}


def test_badge_is_created_already_given_to_people(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    alice, bob = _make_human(db, tenant_a), _make_human(db, tenant_a)
    body = {
        "name": f"Founder {uuid.uuid4().hex[:6]}",
        "images": [{"style_id": style["id"], "image_url": "https://cdn.test/f.webp"}],
        "recipients": [
            {"human_id": str(alice.id), "message": "Thanks for starting this"},
            {"human_id": str(bob.id)},
            # Listed twice: given once.
            {"human_id": str(bob.id)},
        ],
    }
    resp = client.post(BADGES, json=body, headers=admin)
    assert resp.status_code == 201, resp.text
    badge = resp.json()
    assert badge["award_count"] == 2
    [award] = _awards(db, badge["id"], alice.id)
    assert award.issuer_type == "admin" and award.message == "Thanks for starting this"
    assert len(_awards(db, badge["id"], bob.id)) == 1

    # Someone who doesn't exist cancels the whole thing.
    missing = {**body, "name": f"Ghost {uuid.uuid4().hex[:6]}"}
    missing["recipients"] = [{"human_id": str(uuid.uuid4())}]
    assert client.post(BADGES, json=missing, headers=admin).status_code == 404
    listed = client.get(BADGES, params={"limit": 500}, headers=admin).json()
    assert missing["name"] not in {b["name"] for b in listed["results"]}
