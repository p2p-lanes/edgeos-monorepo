"""Opt-in portal visibility filtering preserves the full API/CSV contract."""

import csv
import io
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.crud import applications_crud
from app.api.application.router import _build_directory_entry
from app.api.attendee.models import AttendeeProducts, Attendees
from app.core.security import create_access_token
from tests.api.application import test_attendee_directory_search_privacy as search_tests
from tests.api.application.test_attendee_directory import _privacy_option, _product

search_world = search_tests.search_world

PORTAL_FIELDS = ("first_name", "last_name", "email", "telegram", "role", "organization")


@pytest.fixture()
def empty_row_world(db: Session, search_world):
    hidden = search_world["private"]
    hidden.application.info_not_shared = list(PORTAL_FIELDS)
    # These are shared API/CSV fields, but are not columns in the portal table.
    hidden.human.residence = "India"
    hidden.human.age = "30"
    hidden.human.gender = "Non-binary"
    # Put the empty row first to catch filtering after LIMIT/OFFSET.
    hidden.created_at = datetime.now(UTC) + timedelta(days=1)
    db.add(hidden.application)
    db.add(hidden.human)
    db.add(hidden)
    db.commit()
    return search_world


@pytest.mark.parametrize(
    "style",
    ("lowercase", "capitalized", "mixed_case", "whitespace", "unicode_whitespace"),
)
def test_directory_api_empty_row_filter_is_opt_in_and_csv_is_unchanged(
    db: Session, client: TestClient, empty_row_world, style: str
) -> None:
    hidden = empty_row_world["private"]
    hidden.application.info_not_shared = [
        f"\u00a0{field.upper()}\u3000"
        if style == "unicode_whitespace"
        else _privacy_option(field, style)
        for field in PORTAL_FIELDS
    ]
    db.add(hidden.application)
    db.commit()
    headers = {
        "Authorization": f"Bearer {create_access_token(subject=empty_row_world['public'].human_id, token_type='human')}"
    }
    url = f"/api/v1/applications/my/directory/{empty_row_world['popup'].id}"

    for params in ({}, {"hide_empty_rows": "false"}):
        response = client.get(url, params=params, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["paging"]["total"] == 3
        entry = next(
            row for row in response.json()["results"] if row["id"] == str(hidden.id)
        )
        assert all(entry[field] == "*" for field in PORTAL_FIELDS)
        assert (entry["residence"], entry["age"], entry["gender"]) == (
            "India",
            "30",
            "Non-binary",
        )

    response = client.get(url, params={"hide_empty_rows": "true"}, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["paging"]["total"] == 2
    assert {row["id"] for row in response.json()["results"]} == {
        str(empty_row_world["public"].id),
        str(empty_row_world["companion"].id),
    }
    for row in response.json()["results"]:
        assert all(field in row for field in ("residence", "age", "gender"))

    for filter_value in ("false", "true"):
        response = client.get(
            url,
            params={"q": hidden.human.telegram, "hide_empty_rows": filter_value},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        assert response.json()["paging"]["total"] == 0
        assert response.json()["results"] == []

    response = client.get(f"{url}/csv", headers=headers)
    assert response.status_code == 200, response.text
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == 3
    hidden_row = next(row for row in rows if row["First Name"] == "*")
    assert (hidden_row["Residence"], hidden_row["Age"], hidden_row["Gender"]) == (
        "India",
        "30",
        "Non-binary",
    )


def test_directory_empty_row_filter_precedes_count_and_pagination(
    db: Session, empty_row_world
) -> None:
    popup_id = empty_row_world["popup"].id
    unfiltered, total = applications_crud.find_directory(db, popup_id=popup_id)
    assert total == 3 and unfiltered[0].id == empty_row_world["private"].id
    expected = [row.id for row in unfiltered if row.id != empty_row_world["private"].id]
    for skip in range(3):
        results, total = applications_crud.find_directory(
            db, popup_id=popup_id, skip=skip, limit=1, hide_empty_rows=True
        )
        assert total == 2
        assert [row.id for row in results] == expected[skip : skip + 1]


@pytest.mark.parametrize("field", PORTAL_FIELDS)
def test_one_shared_portal_field_is_enough_to_keep_a_row(
    db: Session, empty_row_world, field: str
) -> None:
    hidden = empty_row_world["private"]
    hidden.application.info_not_shared = [key for key in PORTAL_FIELDS if key != field]
    hidden.application.custom_fields = {
        "role_in_the_organization": "Alias Role",
        "organization_you_represent": "Alias Organization",
    }
    db.add(hidden.application)
    db.commit()
    results, total = applications_crud.find_directory(
        db, popup_id=empty_row_world["popup"].id, hide_empty_rows=True
    )
    assert total == 3 and hidden.id in {row.id for row in results}
    value = getattr(_build_directory_entry(hidden), field)
    assert value and value != "*"


@pytest.mark.parametrize(
    "field", ("first_name", "last_name", "telegram", "role", "organization")
)
@pytest.mark.parametrize("value", (None, "", " \t\n ", "\u00a0 \u3000", "*"))
def test_blank_or_mask_marker_is_not_visible_content(
    db: Session, empty_row_world, field: str, value: str | None
) -> None:
    hidden = empty_row_world["private"]
    hidden.application.info_not_shared = [key for key in PORTAL_FIELDS if key != field]
    if field in ("role", "organization"):
        hidden.application.custom_fields = {field: value}
    else:
        setattr(hidden.human, field, value)
        db.add(hidden.human)
    db.add(hidden.application)
    db.commit()
    # The attendee snapshot still has a name, but must not replace a linked
    # human's blank profile value when the serializer doesn't do so.
    results, total = applications_crud.find_directory(
        db, popup_id=empty_row_world["popup"].id, hide_empty_rows=True
    )
    assert total == 2 and hidden.id not in {row.id for row in results}


@pytest.mark.parametrize(
    "field,alias",
    (
        ("role", "role_in_the_organization"),
        ("organization", "organization_you_represent"),
    ),
)
@pytest.mark.parametrize(
    "canonical", (None, "", " \t\n ", "\u00a0 \u3000", 42, False, [], {})
)
def test_custom_alias_filter_matches_nonblank_text_resolution(
    db: Session, empty_row_world, field: str, alias: str, canonical
) -> None:
    hidden = empty_row_world["private"]
    hidden.application.info_not_shared = [key for key in PORTAL_FIELDS if key != field]
    hidden.application.custom_fields = {field: canonical, alias: "Visible Alias"}
    db.add(hidden.application)
    db.commit()
    results, total = applications_crud.find_directory(
        db, popup_id=empty_row_world["popup"].id, hide_empty_rows=True
    )
    assert total == 3 and hidden.id in {row.id for row in results}
    assert getattr(_build_directory_entry(hidden), field) == "Visible Alias"


@pytest.mark.parametrize(
    "field,alias",
    (
        ("role", "role_in_the_organization"),
        ("organization", "organization_you_represent"),
    ),
)
@pytest.mark.parametrize("non_text", (42, False, [], {}))
def test_non_text_custom_values_cannot_make_a_row_visible(
    db: Session, empty_row_world, field: str, alias: str, non_text
) -> None:
    hidden = empty_row_world["private"]
    hidden.application.info_not_shared = [key for key in PORTAL_FIELDS if key != field]
    hidden.application.custom_fields = {field: non_text, alias: non_text}
    db.add(hidden.application)
    db.commit()
    assert getattr(_build_directory_entry(hidden), field) is None
    results, total = applications_crud.find_directory(
        db, popup_id=empty_row_world["popup"].id, hide_empty_rows=True
    )
    assert total == 2 and hidden.id not in {row.id for row in results}


@pytest.mark.parametrize(
    "field,alias",
    (
        ("role", "role_in_the_organization"),
        ("organization", "organization_you_represent"),
    ),
)
def test_canonical_mask_marker_does_not_fall_back_to_visible_alias(
    db: Session, empty_row_world, field: str, alias: str
) -> None:
    hidden = empty_row_world["private"]
    hidden.application.info_not_shared = [key for key in PORTAL_FIELDS if key != field]
    hidden.application.custom_fields = {field: "*", alias: "Must Not Be Used"}
    db.add(hidden.application)
    db.commit()
    assert getattr(_build_directory_entry(hidden), field) == "*"
    results, total = applications_crud.find_directory(
        db, popup_id=empty_row_world["popup"].id, hide_empty_rows=True
    )
    assert total == 2 and hidden.id not in {row.id for row in results}


@pytest.mark.parametrize(
    "name,email,visible",
    (
        ("Snapshot Name", None, True),
        ("", "snapshot@example.com", True),
        ("", None, False),
        ("", "", False),
        (" \t\n ", " \t\n ", False),
        ("\u00a0 \u3000", "\u00a0 \u3000", False),
        ("*", "*", False),
    ),
)
def test_unlinked_companion_uses_own_snapshot_not_applicant_custom_fields(
    db: Session, empty_row_world, name: str, email: str | None, visible: bool
) -> None:
    popup = empty_row_world["popup"]
    app = empty_row_world["private"].application
    app.custom_fields = {"role": "Applicant Role", "organization": "Applicant Org"}
    db.add(app)
    category_id = empty_row_world["companion"].category_id
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        application_id=app.id,
        category_id=category_id,
        human_id=None,
        name=name,
        email=email,
    )
    db.add(attendee)
    db.commit()
    product = _product(db, popup)
    db.add(
        AttendeeProducts(
            id=uuid.uuid4(),
            tenant_id=popup.tenant_id,
            attendee_id=attendee.id,
            product_id=product.id,
            product_category_snapshot="ticket",
            check_in_code=uuid.uuid4().hex[:10].upper(),
        )
    )
    db.commit()
    results, total = applications_crud.find_directory(
        db, popup_id=popup.id, hide_empty_rows=True
    )
    assert total == 2 + int(visible)
    assert (attendee.id in {row.id for row in results}) is visible


def test_fully_hidden_rows_are_excluded_even_when_all_nine_fields_are_masked(
    db: Session, empty_row_world
) -> None:
    hidden = empty_row_world["private"]
    hidden.application.info_not_shared = [*PORTAL_FIELDS, "Residence", "Age", "Gender"]
    db.add(hidden.application)
    db.commit()
    results, total = applications_crud.find_directory(
        db, popup_id=empty_row_world["popup"].id, hide_empty_rows=True
    )
    assert total == 2 and hidden.id not in {row.id for row in results}


def test_directory_returns_zero_total_when_all_portal_rows_are_empty(
    db: Session, empty_row_world
) -> None:
    public = empty_row_world["public"]
    public.application.info_not_shared = list(PORTAL_FIELDS)
    companion = empty_row_world["companion"]
    companion.human = None
    companion.name = ""
    companion.email = None
    db.add(public.application)
    db.add(companion)
    db.commit()
    results, total = applications_crud.find_directory(
        db, popup_id=empty_row_world["popup"].id, hide_empty_rows=True
    )
    assert results == [] and total == 0


def test_empty_row_filter_can_be_combined_with_search(
    db: Session, empty_row_world
) -> None:
    results, total = applications_crud.find_directory(
        db,
        popup_id=empty_row_world["popup"].id,
        q="PublicGiven PublicSurname",
        hide_empty_rows=True,
    )
    assert total == 1
    assert [row.id for row in results] == [empty_row_world["public"].id]
