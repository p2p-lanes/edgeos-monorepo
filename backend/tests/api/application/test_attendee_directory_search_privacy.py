"""Directory search must match only fields the attendee shares, in SQL."""

import csv
import io
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.crud import applications_crud
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

SEARCH_FIELDS = ("first_name", "last_name", "email", "telegram")
OPTION_STYLES = ("lowercase", "capitalized", "mixed_case", "whitespace")


@pytest.fixture()
def search_world(db: Session, tenant_a: Tenants):
    popup = _popup(db, tenant_a)
    popup.show_attendee_directory = True
    db.add(popup)
    db.commit()
    main = _category(db, popup, "main", is_primary=True)
    spouse = _category(db, popup, "spouse", is_primary=False)
    product = _product(db, popup)

    public = _human(
        db, tenant_a, "PublicGiven", "PublicSurname", telegram="publichandle"
    )
    public.email = f"public-contact-{uuid.uuid4().hex}@example.com"
    db.add(public)
    db.commit()
    public_app = _application(db, popup, public)
    public_attendee = _attendee(
        db, popup, public_app, public, main, tickets=1, product=product
    )

    private = _human(
        db, tenant_a, "VeiledGiven", "VeiledSurname", telegram="privatehandle"
    )
    private.email = f"private-contact-{uuid.uuid4().hex}@example.com"
    db.add(private)
    db.commit()
    private_app = _application(db, popup, private)
    private_attendee = _attendee(
        db, popup, private_app, private, main, tickets=1, product=product
    )

    companion = _human(
        db, tenant_a, "CompanionGiven", "CompanionSurname", telegram="companionhandle"
    )
    companion.email = f"companion-contact-{uuid.uuid4().hex}@example.com"
    db.add(companion)
    db.commit()
    companion_attendee = _attendee(
        db, popup, private_app, companion, spouse, tickets=1, product=product
    )

    return {
        "popup": popup,
        "private": private_attendee,
        "public": public_attendee,
        "companion": companion_attendee,
    }


def _hide_fields(db: Session, attendee, fields: tuple[str, ...], style: str) -> None:
    attendee.application.info_not_shared = [
        _privacy_option(field, style) for field in fields
    ]
    db.add(attendee.application)
    db.commit()


@pytest.mark.parametrize("style", OPTION_STYLES)
@pytest.mark.parametrize("hidden_field", SEARCH_FIELDS)
def test_directory_search_matches_only_shared_fields(
    db: Session, search_world, hidden_field: str, style: str
) -> None:
    private = search_world["private"]
    _hide_fields(db, private, (hidden_field,), style)

    for field in SEARCH_FIELDS:
        results, total = applications_crud.find_directory(
            db,
            popup_id=search_world["popup"].id,
            q=getattr(private.human, field).upper(),
        )
        if field == hidden_field:
            assert total == 0
            assert results == []
        else:
            assert total == 1
            assert [attendee.id for attendee in results] == [private.id]

    # Neither full-name nor cross-column substring search may use a hidden part.
    for query in ("VeiledGiven VeiledSurname", "Given Veiled"):
        results, total = applications_crud.find_directory(
            db, popup_id=search_world["popup"].id, q=query
        )
        if hidden_field in ("first_name", "last_name"):
            assert total == 0
            assert results == []
        else:
            assert total == 1
            assert [attendee.id for attendee in results] == [private.id]


@pytest.mark.parametrize("style", OPTION_STYLES)
@pytest.mark.parametrize("hidden_field", SEARCH_FIELDS)
def test_directory_search_api_and_csv_do_not_reveal_hidden_matches(
    db: Session, client: TestClient, search_world, hidden_field: str, style: str
) -> None:
    private = search_world["private"]
    _hide_fields(db, private, (hidden_field,), style)
    headers = {
        "Authorization": f"Bearer {create_access_token(subject=search_world['public'].human_id, token_type='human')}"
    }
    url = f"/api/v1/applications/my/directory/{search_world['popup'].id}"
    queries = [getattr(private.human, hidden_field)]
    if hidden_field in ("first_name", "last_name"):
        queries.append("VeiledGiven VeiledSurname")

    for query in queries:
        response = client.get(url, params={"q": query}, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["results"] == []
        assert response.json()["paging"]["total"] == 0

        response = client.get(f"{url}/csv", params={"q": query}, headers=headers)
        assert response.status_code == 200, response.text
        assert list(csv.DictReader(io.StringIO(response.text))) == []

    # A visible field still finds the same person in both surfaces.
    visible_field = "last_name" if hidden_field == "first_name" else "first_name"
    params = {"q": getattr(private.human, visible_field)}
    response = client.get(url, params=params, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["paging"]["total"] == 1
    assert [entry["id"] for entry in response.json()["results"]] == [str(private.id)]
    assert response.json()["results"][0][hidden_field] == "*"

    response = client.get(f"{url}/csv", params=params, headers=headers)
    assert response.status_code == 200, response.text
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == 1
    assert rows[0][hidden_field.replace("_", " ").title()] == "*"


@pytest.mark.parametrize("style", OPTION_STYLES)
@pytest.mark.parametrize("hidden_field", ("email", "telegram"))
def test_directory_search_filters_privacy_before_count_and_pagination(
    db: Session, search_world, hidden_field: str, style: str
) -> None:
    private = search_world["private"]
    public = search_world["public"]
    _hide_fields(db, private, (hidden_field,), style)
    setattr(
        private.human,
        hidden_field,
        f"sharedneedle-private-{uuid.uuid4().hex}@example.com",
    )
    setattr(
        public.human,
        hidden_field,
        f"sharedneedle-public-{uuid.uuid4().hex}@example.com",
    )
    db.add(private.human)
    db.add(public.human)
    db.commit()

    results, total = applications_crud.find_directory(
        db, popup_id=search_world["popup"].id, q="sharedneedle", limit=1
    )
    assert total == 1
    assert [attendee.id for attendee in results] == [public.id]

    results, total = applications_crud.find_directory(
        db, popup_id=search_world["popup"].id, q="sharedneedle", skip=1, limit=1
    )
    assert total == 1
    assert results == []


@pytest.mark.parametrize("style", OPTION_STYLES)
def test_directory_search_companions_do_not_inherit_applicant_privacy(
    db: Session, search_world, style: str
) -> None:
    _hide_fields(db, search_world["private"], SEARCH_FIELDS, style)
    companion = search_world["companion"]
    queries = [getattr(companion.human, field) for field in SEARCH_FIELDS]
    queries.append("CompanionGiven CompanionSurname")
    for query in queries:
        results, total = applications_crud.find_directory(
            db, popup_id=search_world["popup"].id, q=query
        )
        assert total == 1
        assert [attendee.id for attendee in results] == [companion.id]


@pytest.mark.parametrize("query", ("%", "_"))
def test_directory_search_does_not_match_empty_hidden_full_name(
    db: Session, search_world, query: str
) -> None:
    _hide_fields(db, search_world["private"], SEARCH_FIELDS, "capitalized")
    results, total = applications_crud.find_directory(
        db, popup_id=search_world["popup"].id, q=query
    )
    assert total == 2
    assert {attendee.id for attendee in results} == {
        search_world["public"].id,
        search_world["companion"].id,
    }


def test_directory_search_empty_preferences_keeps_fields_searchable(
    db: Session, search_world
) -> None:
    private = search_world["private"]
    assert private.application.info_not_shared == []
    for field in SEARCH_FIELDS:
        results, total = applications_crud.find_directory(
            db, popup_id=search_world["popup"].id, q=getattr(private.human, field)
        )
        assert total == 1
        assert [attendee.id for attendee in results] == [private.id]


def test_directory_search_can_match_value_shared_in_another_field(
    db: Session, search_world
) -> None:
    private = search_world["private"]
    _hide_fields(db, private, ("email",), "capitalized")
    private.human.telegram = private.human.email
    db.add(private.human)
    db.commit()
    results, total = applications_crud.find_directory(
        db, popup_id=search_world["popup"].id, q=private.human.email
    )
    assert total == 1
    assert [attendee.id for attendee in results] == [private.id]
