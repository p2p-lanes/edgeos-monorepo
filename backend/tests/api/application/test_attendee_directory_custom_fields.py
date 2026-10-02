"""Resolve directory role/organization aliases without changing API or privacy."""

import csv
import io

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.router import _build_directory_entry
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests.api.application.test_attendee_directory import (
    _application,
    _attendee,
    _category,
    _human,
    _popup,
    _privacy_option,
    _product,
)

DIRECTORY_CUSTOM_KEYS = (
    ("role", "role_in_the_organization"),
    ("organization", "organization_you_represent"),
)


@pytest.fixture()
def custom_field_world(db: Session, tenant_a: Tenants):
    popup = _popup(db, tenant_a)
    popup.show_attendee_directory = True
    db.add(popup)
    db.commit()
    main = _category(db, popup, "main", is_primary=True)
    spouse = _category(db, popup, "spouse", is_primary=False)
    human = _human(db, tenant_a, "Main", "Applicant")
    companion = _human(db, tenant_a, "Visible", "Companion")
    app = _application(db, popup, human)
    product = _product(db, popup)
    main_attendee = _attendee(db, popup, app, human, main, tickets=1, product=product)
    spouse_attendee = _attendee(
        db, popup, app, companion, spouse, tickets=1, product=product
    )
    return {
        "popup": popup,
        "app": app,
        "main": main_attendee,
        "spouse": spouse_attendee,
    }


@pytest.mark.parametrize("field,alias", DIRECTORY_CUSTOM_KEYS)
@pytest.mark.parametrize(
    "values,expected",
    [
        pytest.param({}, None, id="missing"),
        pytest.param({"canonical": "Canonical"}, "Canonical", id="canonical-only"),
        pytest.param({"alias": "India"}, "India", id="alias-only"),
        pytest.param(
            {"canonical": "Canonical", "alias": "India"},
            "Canonical",
            id="canonical-wins",
        ),
        pytest.param(
            {"canonical": None, "alias": "India"}, "India", id="null-canonical"
        ),
        pytest.param(
            {"canonical": "", "alias": "India"}, "India", id="empty-canonical"
        ),
        pytest.param(
            {"canonical": " \t\n ", "alias": "India"}, "India", id="blank-canonical"
        ),
        pytest.param(
            {"canonical": " Canonical ", "alias": "India"},
            " Canonical ",
            id="preserve-content",
        ),
        pytest.param({"alias": None}, None, id="null-alias"),
        pytest.param({"alias": ""}, None, id="empty-alias"),
        pytest.param({"alias": " \t\n "}, None, id="blank-alias"),
        pytest.param({"canonical": " \t\n ", "alias": ""}, None, id="both-blank"),
    ],
)
def test_directory_custom_field_prefers_nonempty_canonical_then_alias(
    db: Session,
    custom_field_world,
    field: str,
    alias: str,
    values: dict,
    expected: str | None,
) -> None:
    app = custom_field_world["app"]
    keys = {"canonical": field, "alias": alias}
    custom = {keys[key]: value for key, value in values.items()}
    app.custom_fields = custom
    db.add(app)
    db.commit()

    entry = _build_directory_entry(custom_field_world["main"])
    assert getattr(entry, field) == expected
    other_field = "organization" if field == "role" else "role"
    assert getattr(entry, other_field) is None
    companion_entry = _build_directory_entry(custom_field_world["spouse"])
    assert companion_entry.role is None
    assert companion_entry.organization is None
    db.refresh(app)
    assert app.custom_fields == custom


@pytest.mark.parametrize(
    "style", ("lowercase", "capitalized", "mixed_case", "whitespace")
)
@pytest.mark.parametrize(
    "hidden_fields", ((), ("role",), ("organization",), ("role", "organization"))
)
def test_directory_custom_aliases_api_and_csv_keep_canonical_keys_and_privacy(
    db: Session,
    client: TestClient,
    custom_field_world,
    hidden_fields: tuple[str, ...],
    style: str,
) -> None:
    app = custom_field_world["app"]
    custom = {
        "role_in_the_organization": "Founder",
        "organization_you_represent": "India Organization",
    }
    options = [_privacy_option(field, style) for field in hidden_fields]
    app.custom_fields = custom
    app.info_not_shared = options
    db.add(app)
    db.commit()
    main = custom_field_world["main"]
    spouse = custom_field_world["spouse"]
    headers = {
        "Authorization": f"Bearer {create_access_token(subject=main.human_id, token_type='human')}"
    }
    url = f"/api/v1/applications/my/directory/{custom_field_world['popup'].id}"
    expected = {
        "role": "*" if "role" in hidden_fields else "Founder",
        "organization": "*"
        if "organization" in hidden_fields
        else "India Organization",
    }

    response = client.get(url, headers=headers)
    assert response.status_code == 200, response.text
    entries = {entry["id"]: entry for entry in response.json()["results"]}
    for field, alias in DIRECTORY_CUSTOM_KEYS:
        assert entries[str(main.id)][field] == expected[field]
        assert alias not in entries[str(main.id)]
        assert entries[str(spouse.id)][field] is None
    assert entries[str(main.id)]["first_name"] == main.human.first_name

    response = client.get(f"{url}/csv", headers=headers)
    assert response.status_code == 200, response.text
    reader = csv.DictReader(io.StringIO(response.text))
    assert reader.fieldnames == [
        "First Name",
        "Last Name",
        "Email",
        "Telegram",
        "Role",
        "Organization",
        "Residence",
        "Age",
        "Gender",
    ]
    rows = {row["First Name"]: row for row in reader}
    for field, value in expected.items():
        assert rows[main.human.first_name][field.capitalize()] == value
        assert rows[spouse.human.first_name][field.capitalize()] == ""
    db.refresh(app)
    assert app.custom_fields == custom
    assert app.info_not_shared == options
