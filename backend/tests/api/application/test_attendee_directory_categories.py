"""Read-normalized category keys without mutating records or weakening privacy."""

import csv
import io
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.crud import applications_crud
from app.api.application.router import _build_directory_entry
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests.api.application.test_attendee_directory import (
    _application,
    _attendee,
    _category,
    _human,
    _popup,
    _product,
)

PORTAL_FIELDS = ("first_name", "last_name", "email", "telegram", "role", "organization")
ALL_FIELDS = (*PORTAL_FIELDS, "residence", "age", "gender")
CATEGORY_STYLES = (
    pytest.param(("main", "spouse"), id="canonical"),
    pytest.param(("Main", "Spouse"), id="capitalized"),
    pytest.param(("MAIN", "SPOUSE"), id="uppercase"),
    pytest.param((" \tMaIn\n", " \tSpOuSe\n"), id="ascii-whitespace"),
    pytest.param(("\u00a0MAIN\u3000", "\u00a0Spouse\u3000"), id="unicode-whitespace"),
)


@pytest.fixture(params=CATEGORY_STYLES)
def category_world(request, db: Session, tenant_a: Tenants):
    main_key, spouse_key = request.param
    popup = _popup(db, tenant_a)
    popup.show_attendee_directory = True
    main = _category(db, popup, "main", is_primary=True)
    spouse = _category(db, popup, "spouse", is_primary=False)
    main.key = main_key
    spouse.key = spouse_key
    db.add(popup)
    db.add(main)
    db.add(spouse)
    db.commit()
    product = _product(db, popup)
    applicant = _human(
        db,
        tenant_a,
        "Applicant",
        "Private",
        telegram="private_handle",
        residence="India",
        age="30",
        gender="Non-binary",
    )
    companion = _human(db, tenant_a, "Companion", "Visible", telegram="public_handle")
    app = _application(
        db,
        popup,
        applicant,
        custom_fields={
            "role_in_the_organization": "Applicant Role",
            "organization_you_represent": "Applicant Org",
        },
        info_not_shared=list(ALL_FIELDS),
    )
    primary = _attendee(db, popup, app, applicant, main, tickets=1, product=product)
    linked = _attendee(db, popup, app, companion, spouse, tickets=1, product=product)
    snapshot = _attendee(db, popup, app, companion, spouse, tickets=1, product=product)
    snapshot.human = None
    snapshot.name = "Snapshot Companion"
    snapshot.email = "snapshot@example.test"
    db.add(snapshot)
    db.commit()
    return {
        "popup": popup,
        "app": app,
        "main": primary,
        "linked": linked,
        "snapshot": snapshot,
        "categories": (main, spouse),
        "keys": (main_key, spouse_key),
    }


def test_categories_are_normalized_for_selection_and_main_masking(
    db: Session, category_world
) -> None:
    world = category_world
    rows, total = applications_crud.find_directory(db, popup_id=world["popup"].id)
    assert total == 3
    assert {row.id for row in rows} == {
        world[key].id for key in ("main", "linked", "snapshot")
    }
    primary = _build_directory_entry(world["main"])
    assert primary.category == world["keys"][0]
    assert all(getattr(primary, field) == "*" for field in ALL_FIELDS)
    linked = _build_directory_entry(world["linked"])
    assert (linked.first_name, linked.email) == (
        "Companion",
        world["linked"].human.email,
    )
    assert linked.role is None and linked.organization is None
    snapshot = _build_directory_entry(world["snapshot"])
    assert (snapshot.first_name, snapshot.email) == (
        "Snapshot Companion",
        "snapshot@example.test",
    )
    assert snapshot.role is None and snapshot.organization is None
    for category, original in zip(world["categories"], world["keys"], strict=True):
        db.refresh(category)
        assert category.key == original
    rows, total = applications_crud.find_directory(
        db, popup_id=world["popup"].id, hide_empty_rows=True
    )
    assert total == 2
    assert {row.id for row in rows} == {world["linked"].id, world["snapshot"].id}


@pytest.mark.parametrize("field", ("role", "organization"))
def test_normalized_main_with_only_shared_alias_stays_visible(
    db: Session, category_world, field: str
) -> None:
    world = category_world
    world["app"].info_not_shared = [key for key in ALL_FIELDS if key != field]
    db.add(world["app"])
    db.commit()
    rows, total = applications_crud.find_directory(
        db, popup_id=world["popup"].id, hide_empty_rows=True
    )
    assert total == 3 and world["main"].id in {row.id for row in rows}
    entry = _build_directory_entry(world["main"])
    assert getattr(entry, field) == (
        "Applicant Role" if field == "role" else "Applicant Org"
    )
    assert all(getattr(entry, key) == "*" for key in ALL_FIELDS if key != field)


def test_host_picker_normalizes_categories_without_inheriting_parent_privacy(
    db: Session, category_world
) -> None:
    world = category_world
    for query in (None, "Companion Visible"):
        humans, total = applications_crud.find_directory_humans(
            db, popup_id=world["popup"].id, q=query
        )
        assert total == 1
        assert [human.id for human in humans] == [world["linked"].human_id]
    humans, total = applications_crud.find_directory_humans(
        db, popup_id=world["popup"].id, q="Applicant Private"
    )
    assert humans == [] and total == 0


def test_search_never_uses_normalized_main_hidden_fields(
    db: Session, category_world
) -> None:
    world = category_world
    for hide_empty in (False, True):
        for field in ("first_name", "last_name", "email", "telegram"):
            rows, total = applications_crud.find_directory(
                db,
                popup_id=world["popup"].id,
                q=getattr(world["main"].human, field),
                hide_empty_rows=hide_empty,
            )
            assert rows == [] and total == 0
        rows, total = applications_crud.find_directory(
            db,
            popup_id=world["popup"].id,
            q="Companion Visible",
            hide_empty_rows=hide_empty,
        )
        assert total == 1 and [row.id for row in rows] == [world["linked"].id]


def test_normalized_category_filter_precedes_count_and_pagination(
    db: Session, category_world
) -> None:
    world = category_world
    for hide_empty, count in ((False, 3), (True, 2)):
        baseline, total = applications_crud.find_directory(
            db, popup_id=world["popup"].id, hide_empty_rows=hide_empty
        )
        assert total == count
        for skip in range(count + 1):
            page, total = applications_crud.find_directory(
                db,
                popup_id=world["popup"].id,
                skip=skip,
                limit=1,
                hide_empty_rows=hide_empty,
            )
            assert total == count
            assert [row.id for row in page] == [row.id for row in baseline][
                skip : skip + 1
            ]


def test_api_and_csv_preserve_original_category_values_and_companion_snapshots(
    client: TestClient, category_world
) -> None:
    world = category_world
    url = f"/api/v1/applications/my/directory/{world['popup'].id}"
    token = create_access_token(subject=world["main"].human_id, token_type="human")
    headers = {"Authorization": f"Bearer {token}"}
    for params, count in (({}, 3), ({"hide_empty_rows": "true"}, 2)):
        response = client.get(url, params=params, headers=headers)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["paging"]["total"] == count and len(data["results"]) == count
        if not params:
            primary = next(
                row for row in data["results"] if row["id"] == str(world["main"].id)
            )
            assert primary["category"] == world["keys"][0]
            assert all(primary[field] == "*" for field in ALL_FIELDS)
        companion = next(
            row for row in data["results"] if row["id"] == str(world["linked"].id)
        )
        assert (
            companion["category"] == world["keys"][1]
            and companion["first_name"] == "Companion"
        )
        assert companion["role"] is None and companion["organization"] is None
        snapshot = next(
            row for row in data["results"] if row["id"] == str(world["snapshot"].id)
        )
        assert (snapshot["first_name"], snapshot["email"]) == (
            "Snapshot Companion",
            "snapshot@example.test",
        )
    response = client.get(f"{url}/csv", headers=headers)
    assert response.status_code == 200, response.text
    rows = list(csv.reader(io.StringIO(response.text)))
    assert len(rows) == 4 and len(rows[0]) == 9
    assert ["*"] * 9 in rows[1:]
    assert any(
        row[0] == "Snapshot Companion" and row[2] == "snapshot@example.test"
        for row in rows[1:]
    )


@pytest.mark.parametrize("key", ("Kid", "Nanny/Caretaker"))
def test_other_categories_remain_excluded(
    db: Session, tenant_a: Tenants, category_world, key: str
) -> None:
    world = category_world
    category = _category(db, world["popup"], key, is_primary=False)
    person = _human(db, tenant_a, "Excluded", "Person")
    excluded = _attendee(db, world["popup"], world["app"], person, category, tickets=1)
    rows, total = applications_crud.find_directory(db, popup_id=world["popup"].id)
    assert total == 3 and excluded.id not in {row.id for row in rows}
    humans, total = applications_crud.find_directory_humans(
        db, popup_id=world["popup"].id
    )
    assert total == 1 and person.id not in {human.id for human in humans}


def test_revoked_spouse_tickets_are_still_excluded(db: Session, category_world) -> None:
    world = category_world
    for ticket in world["linked"].attendee_products:
        ticket.revoked_at = datetime.now(UTC)
        db.add(ticket)
    db.commit()
    rows, total = applications_crud.find_directory(
        db, popup_id=world["popup"].id, hide_empty_rows=True
    )
    assert total == 1 and [row.id for row in rows] == [world["snapshot"].id]
    humans, total = applications_crud.find_directory_humans(
        db, popup_id=world["popup"].id
    )
    assert humans == [] and total == 0
