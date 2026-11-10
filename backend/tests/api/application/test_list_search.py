"""``search`` on GET /applications and /applications/group-counts (BO list).

The search matches a human's first name, last name, email, and full name in
both "first last" and "last first" order. It is case-insensitive, trimmed,
and collapses repeated whitespace. The list, its paging total and the grouped
counts share one clause, so they always agree.

Each test creates a fresh popup and scopes by popup_id so it is isolated
from the session-scoped shared fixtures (db / tenant_a have no per-test
rollback).
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from tests._flow_helpers import application_flow_id
from tests.api.application.test_group_counts import _buckets, _group_counts
from tests.api.application.test_list_filters import _list
from tests.api.application_review.test_pending_reviews import (
    _make_admin,
    _make_popup,
)


def _make_named_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    first_name: str | None,
    last_name: str | None,
    email: str | None = None,
) -> Applications:
    human = Humans(
        tenant_id=tenant.id,
        email=email or f"search-{uuid.uuid4().hex[:8]}@test.com",
        first_name=first_name,
        last_name=last_name,
    )
    db.add(human)
    db.flush()
    application = Applications(
        sales_flow_id=application_flow_id(db, popup.id),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status="in review",
        custom_fields={},
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


@pytest.fixture
def search_world(db: Session, tenant_a: Tenants, tenant_b: Tenants):
    popup = _make_popup(db, tenant_a)
    admin = _make_admin(db, tenant_a)
    tag = uuid.uuid4().hex[:8]
    apps = {
        "john": _make_named_application(
            db, tenant_a, popup, "John", "Doe", f"jdoe-{tag}@example.com"
        ),
        "jane": _make_named_application(db, tenant_a, popup, "Jane", "Doe"),
        "mary": _make_named_application(db, tenant_a, popup, "Mary Jane", "Watson"),
        "johnny": _make_named_application(db, tenant_a, popup, "Johnny", "Smith"),
        # Stray whitespace in the stored data must not break full-name matches.
        "messy": _make_named_application(db, tenant_a, popup, "  Ada ", " Lovelace"),
        "nameless": _make_named_application(db, tenant_a, popup, None, None),
    }

    # Same name in another tenant: must never surface for tenant A.
    other_popup = _make_popup(db, tenant_b)
    other_admin = _make_admin(db, tenant_b)
    other_john = _make_named_application(db, tenant_b, other_popup, "John", "Doe")

    return {
        "popup": popup,
        "admin": admin,
        "apps": apps,
        "tag": tag,
        "other_popup": other_popup,
        "other_admin": other_admin,
        "other_john": other_john,
    }


def _search(client: TestClient, world, tenant: Tenants, search: str, **extra):
    response = _list(
        client, world["admin"], tenant, world["popup"], search=search, **extra
    )
    assert response.status_code == 200, response.text
    return response.json()


def _found(body) -> set[str]:
    return {row["id"] for row in body["results"]}


def _ids_of(world, *keys: str) -> set[str]:
    return {str(world["apps"][key].id) for key in keys}


class TestApplicationListSearch:
    @pytest.mark.parametrize(
        "search",
        [
            "John Doe",
            "john doe",
            "JOHN DOE",
            "  John   Doe ",
            "\tJohn\n Doe",
            "Doe John",
        ],
    )
    def test_full_name_variants(
        self, client: TestClient, tenant_a: Tenants, search_world, search: str
    ) -> None:
        body = _search(client, search_world, tenant_a, search)
        assert _found(body) == _ids_of(search_world, "john")
        assert body["paging"]["total"] == 1

    def test_partial_full_name(
        self, client: TestClient, tenant_a: Tenants, search_world
    ) -> None:
        # "n Do" spans the boundary between first and last name.
        body = _search(client, search_world, tenant_a, "n Do")
        assert _found(body) == _ids_of(search_world, "john")

    def test_single_name_part(
        self, client: TestClient, tenant_a: Tenants, search_world
    ) -> None:
        body = _search(client, search_world, tenant_a, "Doe")
        assert _found(body) == _ids_of(search_world, "john", "jane")
        assert body["paging"]["total"] == 2

        body = _search(client, search_world, tenant_a, "john")
        assert _found(body) == _ids_of(search_world, "john", "johnny")

    def test_multi_word_first_name(
        self, client: TestClient, tenant_a: Tenants, search_world
    ) -> None:
        for search in ("Mary Jane Watson", "watson mary jane", "Jane Watson"):
            body = _search(client, search_world, tenant_a, search)
            assert _found(body) == _ids_of(search_world, "mary"), search

    def test_stored_whitespace_is_normalized(
        self, client: TestClient, tenant_a: Tenants, search_world
    ) -> None:
        body = _search(client, search_world, tenant_a, "ada lovelace")
        assert _found(body) == _ids_of(search_world, "messy")

    def test_email(self, client: TestClient, tenant_a: Tenants, search_world) -> None:
        email = f"jdoe-{search_world['tag']}@example.com"
        body = _search(client, search_world, tenant_a, f"  {email.upper()} ")
        assert _found(body) == _ids_of(search_world, "john")

    def test_blank_search_returns_everything(
        self, client: TestClient, tenant_a: Tenants, search_world
    ) -> None:
        body = _search(client, search_world, tenant_a, "   ")
        assert body["paging"]["total"] == len(search_world["apps"])

    def test_no_match(
        self, client: TestClient, tenant_a: Tenants, search_world
    ) -> None:
        body = _search(client, search_world, tenant_a, "John Watson")
        assert body["results"] == []
        assert body["paging"]["total"] == 0

    def test_paging_total_counts_all_matches(
        self, client: TestClient, tenant_a: Tenants, search_world
    ) -> None:
        body = _search(client, search_world, tenant_a, "doe", limit=1)
        assert len(body["results"]) == 1
        assert body["paging"]["total"] == 2

    def test_group_counts_use_same_search(
        self, client: TestClient, tenant_a: Tenants, search_world
    ) -> None:
        response = _group_counts(
            client,
            search_world["admin"],
            tenant_a,
            search_world["popup"],
            "status",
            search="  john   DOE ",
        )
        assert _buckets(response) == {"in review": 1}

    def test_no_cross_tenant_leakage(
        self,
        client: TestClient,
        tenant_a: Tenants,
        tenant_b: Tenants,
        search_world,
    ) -> None:
        other_john_id = str(search_world["other_john"].id)

        body = _search(client, search_world, tenant_a, "John Doe")
        assert other_john_id not in _found(body)

        # Pointing tenant A's admin at tenant B's popup finds nothing.
        response = _list(
            client,
            search_world["admin"],
            tenant_a,
            search_world["other_popup"],
            search="John Doe",
        )
        assert response.status_code == 200, response.text
        assert response.json()["results"] == []
        assert response.json()["paging"]["total"] == 0

        # Tenant B's own admin sees only its John Doe.
        response = _list(
            client,
            search_world["other_admin"],
            tenant_b,
            search_world["other_popup"],
            search="john doe",
        )
        assert response.status_code == 200, response.text
        assert _found(response.json()) == {other_john_id}
