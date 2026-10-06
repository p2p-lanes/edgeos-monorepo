"""SIM-108 phase 3: badges awarded automatically from check-ins."""

import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.badge.models import BadgeAwards
from app.api.badge.rules import sweep_badge_rules
from app.api.event_participant.models import EventCheckIns
from app.api.tenant.models import Tenants
from app.api.track.models import Tracks
from tests.test_event_qr_check_in import (
    _check_in,
    _give_ticket,
    _make_event,
    _make_human,
    _make_popup,
)

BADGES = "/api/v1/badges"
RULES = "/api/v1/badge-rules"


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


def _track_with_events(db: Session, tenant: Tenants, count: int):
    popup = _make_popup(db, tenant)
    track = Tracks(tenant_id=tenant.id, popup_id=popup.id, name="Sauna sessions")
    db.add(track)
    db.commit()
    db.refresh(track)
    events = []
    for _ in range(count):
        event = _make_event(db, tenant, popup)
        event.track_id = track.id
        db.add(event)
        db.commit()
        db.refresh(event)
        events.append(event)
    return popup, track, events


def _rule(client: TestClient, admin, badge, config: dict, **extra) -> dict:
    resp = client.post(
        RULES,
        json={"badge_id": badge["id"], "config": config, **extra},
        headers=admin,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


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


def test_badge_lands_on_the_check_in_that_reaches_the_threshold(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    popup, track, events = _track_with_events(db, tenant_a, 3)
    badge = _badge(client, admin, style)
    rule = _rule(
        client,
        admin,
        badge,
        {"type": "checkins_in_track", "track_id": str(track.id), "threshold": 2},
    )
    human = _make_human(db, tenant_a)
    _give_ticket(db, tenant_a, popup, human)

    assert _check_in(client, human, events[0]).status_code == 200
    assert _awards(db, badge["id"], human.id) == []

    assert _check_in(client, human, events[1]).status_code == 200
    [award] = _awards(db, badge["id"], human.id)
    assert award.issuer_type == "rule"
    assert str(award.rule_id) == rule["id"]

    # Going past the threshold never awards it twice.
    assert _check_in(client, human, events[2]).status_code == 200
    assert len(_awards(db, badge["id"], human.id)) == 1

    listed = client.get(RULES, params={"badge_id": badge["id"]}, headers=admin)
    assert listed.json()[0]["award_count"] == 1


def test_new_rule_awards_history_but_ignores_voided_check_ins(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    popup, track, events = _track_with_events(db, tenant_a, 2)
    regular, voided = _make_human(db, tenant_a), _make_human(db, tenant_a)
    for human in (regular, voided):
        _give_ticket(db, tenant_a, popup, human)
        for event in events:
            assert _check_in(client, human, event).status_code == 200
    # One of the second person's marks was a mistake.
    mark = db.exec(
        select(EventCheckIns).where(
            EventCheckIns.profile_id == voided.id,
            EventCheckIns.event_id == events[0].id,
        )
    ).one()
    mark.voided_at = datetime.now(UTC)
    mark.void_reason = "Scanned by mistake"
    db.add(mark)
    db.commit()

    badge = _badge(client, admin, style)
    rule = _rule(
        client,
        admin,
        badge,
        {"type": "checkins_in_track", "track_id": str(track.id), "threshold": 2},
    )
    assert rule["award_count"] == 1
    assert len(_awards(db, badge["id"], regular.id)) == 1
    assert _awards(db, badge["id"], voided.id) == []


def test_admin_revoke_is_not_undone_by_the_rule(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    popup, _track, events = _track_with_events(db, tenant_a, 1)
    badge = _badge(client, admin, style, repeatable=True)
    rule = _rule(
        client,
        admin,
        badge,
        {"type": "checkins_in_popup", "popup_id": str(popup.id), "threshold": 1},
    )
    human = _make_human(db, tenant_a)
    _give_ticket(db, tenant_a, popup, human)
    assert _check_in(client, human, events[0]).status_code == 200
    [award] = _awards(db, badge["id"], human.id)

    revoke = client.post(
        f"{BADGES}/awards/{award.id}/revoke", json={"reason": "Test"}, headers=admin
    )
    assert revoke.status_code == 200
    resp = client.post(f"{RULES}/{rule['id']}/evaluate", headers=admin)
    assert resp.json()["awarded"] == 0
    assert len(_awards(db, badge["id"], human.id)) == 1


def test_a_failing_rule_never_breaks_the_check_in(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    popup, track, events = _track_with_events(db, tenant_a, 1)
    badge = _badge(client, admin, style)
    _rule(
        client,
        admin,
        badge,
        {"type": "checkins_in_track", "track_id": str(track.id), "threshold": 1},
    )
    human = _make_human(db, tenant_a)
    _give_ticket(db, tenant_a, popup, human)
    with patch("app.api.badge.rules.evaluate_rule", side_effect=RuntimeError("boom")):
        assert _check_in(client, human, events[0]).status_code == 200
    assert _awards(db, badge["id"], human.id) == []

    # The sweep picks it up later, and a second run is a no-op.
    first = sweep_badge_rules(db)
    assert first["failures"] == 0 and first["awarded"] >= 1
    assert len(_awards(db, badge["id"], human.id)) == 1
    assert sweep_badge_rules(db)["awarded"] == 0


def test_rule_validation(client: TestClient, admin, style):
    badge = _badge(client, admin, style)
    unknown = client.post(
        RULES,
        json={
            "badge_id": badge["id"],
            "config": {
                "type": "checkins_in_track",
                "track_id": str(uuid.uuid4()),
                "threshold": 3,
            },
        },
        headers=admin,
    )
    assert unknown.status_code == 404
    bad = client.post(
        RULES,
        json={
            "badge_id": badge["id"],
            "config": {"type": "checkins_in_popup", "popup_id": str(uuid.uuid4())},
        },
        headers=admin,
    )
    assert bad.status_code == 422


def test_paused_rule_does_nothing(
    client: TestClient, db: Session, tenant_a: Tenants, admin, style
):
    popup, track, events = _track_with_events(db, tenant_a, 1)
    badge = _badge(client, admin, style)
    rule = _rule(
        client,
        admin,
        badge,
        {"type": "checkins_in_track", "track_id": str(track.id), "threshold": 1},
        is_active=False,
    )
    human = _make_human(db, tenant_a)
    _give_ticket(db, tenant_a, popup, human)
    assert _check_in(client, human, events[0]).status_code == 200
    assert _awards(db, badge["id"], human.id) == []

    resp = client.patch(
        f"{RULES}/{rule['id']}", json={"is_active": True}, headers=admin
    )
    assert resp.status_code == 200
    assert (
        client.post(f"{RULES}/{rule['id']}/evaluate", headers=admin).json()["awarded"]
        == 1
    )
