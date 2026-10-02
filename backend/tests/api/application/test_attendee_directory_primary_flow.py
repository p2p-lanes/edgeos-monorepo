"""The directory and its sharing settings use only the designated primary flow."""

import csv
import io
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.crud import applications_crud
from app.api.application.models import Applications
from app.api.attendee_category.models import AttendeeCategories
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests.api.application.test_attendee_directory import (
    _application,
    _attendee,
    _category,
    _human,
    _popup,
)


@pytest.fixture()
def primary_flow_world(db: Session, tenant_a: Tenants):
    popup = _popup(db, tenant_a)
    popup.show_attendee_directory = True
    main = _category(db, popup, "main", is_primary=True)
    primary = sales_flows_crud.get_default_flow(db, popup.id)
    sibling = SalesFlows(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        slug="volunteers",
        name="Volunteers",
        type="application",
        is_default=False,
    )
    db.add(popup)
    db.add(sibling)
    db.flush()
    sibling_main = AttendeeCategories(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=sibling.id,
        key="main",
        label="Main",
        is_primary=True,
    )
    db.add(sibling_main)
    db.commit()

    person = _human(
        db,
        tenant_a,
        "Member",
        "Person",
        telegram="member",
        residence="India",
        gender="Non-binary",
        age="25-34",
    )
    primary_app = _application(
        db,
        popup,
        person,
        custom_fields={"role": "Primary role"},
        info_not_shared=["Email"],
    )
    primary_app.submitted_at = datetime.now(UTC) - timedelta(days=5)
    db.add(primary_app)
    sibling_app = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=person.id,
        sales_flow_id=sibling.id,
        status="accepted",
        submitted_at=datetime.now(UTC),
        custom_fields={"role": "Sibling role"},
        info_not_shared=[],
    )
    sibling_only = _human(db, tenant_a, "Siblingonly", "Person")
    sibling_only_app = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=sibling_only.id,
        sales_flow_id=sibling.id,
        status="accepted",
    )
    db.add(sibling_app)
    db.add(sibling_only_app)
    db.commit()
    primary_attendee = _attendee(db, popup, primary_app, person, main, tickets=1)
    sibling_attendee = _attendee(
        db, popup, sibling_app, person, sibling_main, tickets=1
    )
    sibling_only_attendee = _attendee(
        db, popup, sibling_only_app, sibling_only, sibling_main, tickets=1
    )
    return {
        "popup": popup,
        "primary": primary,
        "sibling": sibling,
        "person": person,
        "primary_app": primary_app,
        "sibling_app": sibling_app,
        "primary_attendee": primary_attendee,
        "sibling_attendee": sibling_attendee,
        "sibling_only": sibling_only,
        "sibling_only_attendee": sibling_only_attendee,
        "headers": {
            "Authorization": f"Bearer {create_access_token(subject=person.id, token_type='human')}"
        },
    }


@pytest.mark.parametrize("hide_empty_rows", (False, True))
def test_directory_filters_primary_flow_before_search_and_pagination(
    db: Session, primary_flow_world, hide_empty_rows: bool
) -> None:
    world = primary_flow_world
    for q, skip, expected_ids, expected_total in (
        (None, 0, [world["primary_attendee"].id], 1),
        ("Member Person", 0, [world["primary_attendee"].id], 1),
        ("Siblingonly", 0, [], 0),
        (None, 1, [], 1),
    ):
        rows, total = applications_crud.find_directory(
            db,
            world["popup"].id,
            q=q,
            skip=skip,
            limit=1,
            hide_empty_rows=hide_empty_rows,
        )
        assert [row.id for row in rows] == expected_ids
        assert total == expected_total


def test_directory_human_picker_cannot_use_a_sibling_to_bypass_primary_privacy(
    db: Session, primary_flow_world
) -> None:
    world = primary_flow_world
    rows, total = applications_crud.find_directory_humans(db, world["popup"].id)
    assert total == 1 and [row.id for row in rows] == [world["person"].id]
    world["primary_app"].info_not_shared = ["first_name"]
    db.add(world["primary_app"])
    db.commit()
    rows, total = applications_crud.find_directory_humans(db, world["popup"].id)
    assert rows == [] and total == 0


def test_directory_api_and_csv_use_primary_application_data(
    client: TestClient, primary_flow_world
) -> None:
    world = primary_flow_world
    url = f"/api/v1/applications/my/directory/{world['popup'].id}"
    response = client.get(url, headers=world["headers"])
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["paging"]["total"] == 1
    assert len(data["results"]) == 1
    assert data["results"][0]["id"] == str(world["primary_attendee"].id)
    assert data["results"][0]["role"] == "Primary role"
    assert data["results"][0]["email"] == "*"
    response = client.get(f"{url}/csv", headers=world["headers"])
    assert response.status_code == 200, response.text
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == 1
    assert rows[0]["Role"] == "Primary role" and rows[0]["Email"] == "*"
    response = client.get(
        f"{url}/csv", params={"q": "Siblingonly"}, headers=world["headers"]
    )
    assert response.status_code == 200, response.text
    assert list(csv.DictReader(io.StringIO(response.text))) == []


def test_primary_application_lookup_does_not_choose_newer_accepted_sibling(
    client: TestClient, primary_flow_world
) -> None:
    world = primary_flow_world
    url = f"/api/v1/applications/my/{world['popup'].id}"
    legacy = client.get(url, headers=world["headers"])
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["id"] == str(world["sibling_app"].id)
    response = client.get(
        url, params={"primary_flow_only": True}, headers=world["headers"]
    )
    assert response.status_code == 200, response.text
    assert response.json()["id"] == str(world["primary_app"].id)
    assert response.json()["sales_flow_id"] == str(world["primary"].id)


def test_sharing_settings_update_only_the_primary_application(
    client: TestClient, db: Session, primary_flow_world
) -> None:
    world = primary_flow_world
    url = f"/api/v1/applications/my/{world['popup'].id}"
    response = client.get(
        url, params={"primary_flow_only": True}, headers=world["headers"]
    )
    assert response.status_code == 200, response.text
    response = client.patch(
        url,
        params={"sales_flow_id": response.json()["sales_flow_id"]},
        json={"info_not_shared": ["Email", "Telegram"]},
        headers=world["headers"],
    )
    assert response.status_code == 200, response.text
    db.refresh(world["primary_app"])
    db.refresh(world["sibling_app"])
    assert world["primary_app"].info_not_shared == ["Email", "Telegram"]
    assert world["sibling_app"].info_not_shared == []


def test_missing_primary_application_returns_404_without_sibling_fallback(
    client: TestClient, primary_flow_world
) -> None:
    world = primary_flow_world
    headers = {
        "Authorization": f"Bearer {create_access_token(subject=world['sibling_only'].id, token_type='human')}"
    }
    response = client.get(
        f"/api/v1/applications/my/{world['popup'].id}",
        params={"primary_flow_only": True},
        headers=headers,
    )
    assert response.status_code == 404, response.text


@pytest.mark.parametrize("primary_state", ("closed", "not_designated", "draft"))
def test_primary_scope_is_explicit_not_status_or_visibility_based(
    client: TestClient, db: Session, primary_flow_world, primary_state: str
) -> None:
    world = primary_flow_world
    if primary_state == "closed":
        world["primary"].status = "closed"
        world["primary"].visibility = "direct_url_only"
    elif primary_state == "not_designated":
        world["primary"].is_default = False
    else:
        world["primary_app"].status = "draft"
        db.add(world["primary_app"])
    db.add(world["primary"])
    db.commit()
    response = client.get(
        f"/api/v1/applications/my/{world['popup'].id}",
        params={"primary_flow_only": True},
        headers=world["headers"],
    )
    if primary_state == "not_designated":
        assert response.status_code == 404, response.text
    else:
        assert response.status_code == 200, response.text
        assert response.json()["id"] == str(world["primary_app"].id)
    rows, total = applications_crud.find_directory(db, world["popup"].id)
    expected_ids = [world["primary_attendee"].id] if primary_state == "closed" else []
    assert [row.id for row in rows] == expected_ids
    assert total == len(expected_ids)


def test_changing_primary_designation_changes_directory_and_settings_together(
    client: TestClient, db: Session, primary_flow_world
) -> None:
    world = primary_flow_world
    world["primary"].is_default = False
    db.add(world["primary"])
    db.flush()
    world["sibling"].is_default = True
    db.add(world["sibling"])
    db.commit()
    rows, total = applications_crud.find_directory(db, world["popup"].id)
    assert total == 2
    assert {row.id for row in rows} == {
        world["sibling_attendee"].id,
        world["sibling_only_attendee"].id,
    }
    response = client.get(
        f"/api/v1/applications/my/{world['popup'].id}",
        params={"primary_flow_only": True},
        headers=world["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["id"] == str(world["sibling_app"].id)
