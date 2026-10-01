import uuid
from unittest.mock import patch

import pytest
from sqlmodel import Session, select

from app.api.approval_strategy.crud import approval_strategies_crud
from app.api.event_settings.crud import event_settings_crud
from app.api.event_settings.models import EventSettings
from app.api.popup.crud import popups_crud
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupCreate
from tests.test_events_approval import _human_auth, _make_human


@pytest.mark.parametrize("sale_type", ["application", "direct"])
@pytest.mark.parametrize("events_enabled", [True, False])
def test_popup_has_event_settings_immediately(
    client, db, tenant_a, admin_token_tenant_a, sale_type, events_enabled
):
    headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}
    created = client.post(
        "/api/v1/popups",
        headers=headers,
        json={
            "name": f"Calendar Defaults {uuid.uuid4().hex[:8]}",
            "sale_type": sale_type,
            "events_enabled": events_enabled,
        },
    )
    assert created.status_code == 201, created.text
    popup_id = created.json()["id"]
    human = _make_human(db, tenant_a)
    for path, auth in [
        (f"/api/v1/event-settings/{popup_id}", headers),
        (f"/api/v1/event-settings/portal/settings/{popup_id}", _human_auth(human)),
    ]:
        settings = client.get(path, headers=auth)
        assert settings.status_code == 200, settings.text
        assert settings.json()["popup_id"] == popup_id
        assert settings.json()["tenant_id"] == str(tenant_a.id)
        assert settings.json()["events_require_approval"] is True
        assert settings.json()["timezone"] == "UTC"

    if events_enabled:
        submitted = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json={
                "popup_id": popup_id,
                "title": "First community event",
                "start_time": "2026-10-01T14:00:00Z",
                "end_time": "2026-10-01T15:00:00Z",
                "custom_location_name": "Community garden",
                "custom_location_url": "https://example.com/garden",
                "status": "published",
            },
        )
        assert submitted.status_code == 201, submitted.text
        assert submitted.json()["status"] == "pending_approval"

    # Ordinary popup edits must not recreate or overwrite configured settings.
    settings_id = settings.json()["id"]
    updated = client.patch(
        f"/api/v1/event-settings/{popup_id}",
        headers=headers,
        json={"events_require_approval": False, "timezone": "Europe/Madrid"},
    )
    assert updated.status_code == 200, updated.text
    changed = client.patch(
        f"/api/v1/popups/{popup_id}", headers=headers, json={"events_enabled": True}
    )
    assert changed.status_code == 200, changed.text
    rows = db.exec(
        select(EventSettings).where(EventSettings.popup_id == uuid.UUID(popup_id))
    ).all()
    assert len(rows) == 1
    assert str(rows[0].id) == settings_id
    assert rows[0].events_require_approval is False
    assert rows[0].timezone == "Europe/Madrid"


def test_failed_popup_creation_rolls_back_event_settings(test_engine, tenant_a):
    popup_id = None

    def fail_after_settings(session, **kwargs):
        nonlocal popup_id
        popup_id = kwargs["popup_id"]
        assert event_settings_crud.get_by_popup_id(session, popup_id) is not None
        raise RuntimeError("Could not create the remaining popup defaults")

    with Session(test_engine) as session:
        with (
            patch.object(
                approval_strategies_crud,
                "create_for_popup",
                side_effect=fail_after_settings,
            ),
            pytest.raises(RuntimeError, match="remaining popup defaults"),
        ):
            popups_crud.create(
                session,
                PopupCreate(
                    name=f"Rolled Back {uuid.uuid4().hex[:8]}", tenant_id=tenant_a.id
                ),
            )
        session.rollback()

    assert popup_id is not None
    with Session(test_engine) as session:
        assert session.get(Popups, popup_id) is None
        assert event_settings_crud.get_by_popup_id(session, popup_id) is None


def test_demo_seed_creates_settings_and_preserves_edits_when_repeated(db, tenant_a):
    from app.core.db import _seed_popups

    seed = {
        "popups": [
            {"key": "demo", "name": "Demo", "slug": f"demo-{uuid.uuid4().hex[:8]}"}
        ]
    }
    popup = _seed_popups(db, seed, tenant_a.id)["demo"]
    settings = event_settings_crud.get_by_popup_id(db, popup.id)
    assert settings is not None
    assert settings.events_require_approval is True
    settings.events_require_approval = False
    db.add(settings)
    db.commit()
    settings_id = settings.id

    assert _seed_popups(db, seed, tenant_a.id)["demo"].id == popup.id
    db.refresh(settings)
    assert settings.id == settings_id
    assert settings.events_require_approval is False


@pytest.mark.parametrize("sale_type", ["application", "direct"])
def test_deleting_popup_removes_its_event_settings(
    client, db, admin_token_tenant_a, sale_type
):
    headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}
    popup_ids = []
    for _ in range(2):
        created = client.post(
            "/api/v1/popups",
            headers=headers,
            json={
                "name": f"Delete Settings {uuid.uuid4().hex[:8]}",
                "sale_type": sale_type,
            },
        )
        assert created.status_code == 201, created.text
        popup_ids.append(uuid.UUID(created.json()["id"]))

    target, retained = popup_ids
    customized = client.patch(
        f"/api/v1/event-settings/{target}",
        headers=headers,
        json={"events_require_approval": False, "timezone": "Europe/Madrid"},
    )
    assert customized.status_code == 200, customized.text
    assert event_settings_crud.get_by_popup_id(db, target) is not None

    deleted = client.delete(f"/api/v1/popups/{target}", headers=headers)
    assert deleted.status_code == 204, deleted.text
    db.expire_all()
    assert db.get(Popups, target) is None
    assert event_settings_crud.get_by_popup_id(db, target) is None
    assert db.get(Popups, retained) is not None
    assert event_settings_crud.get_by_popup_id(db, retained) is not None
