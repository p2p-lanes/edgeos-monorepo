"""Complex ``filters`` query param on GET /humans (BO list).

The param carries a JSON filter group ({match, conditions[]}) built on the
shared engine in app.core.filters and ANDed with the legacy params.
Invalid JSON, unknown fields, or disallowed operators return 422.

Humans are tenant-scoped (not popup-scoped), so each test isolates itself
from the session-scoped shared fixtures by stamping a unique marker into the
email and narrowing every request with the legacy ``email`` substring param.
"""

import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import JSON, null, update
from sqlmodel import Session, func, select

from app.api.human.models import Humans
from app.api.shared.enums import HumanRating
from app.api.tenant.models import Tenants
from tests.api.application_review.test_pending_reviews import _auth, _make_admin

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _marker() -> str:
    return uuid.uuid4().hex[:8]


def _make_human(
    db: Session,
    tenant: Tenants,
    marker: str,
    *,
    first_name: str | None = None,
    last_name: str | None = None,
    gender: str | None = None,
    residence: str | None = None,
    rating: str = HumanRating.UNRATED.value,
    enriched_profile: dict | None = None,
) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"flt-{marker}-{uuid.uuid4().hex[:6]}@test.com",
        first_name=first_name,
        last_name=last_name,
        gender=gender,
        residence=residence,
        rating=rating,
    )
    if enriched_profile is not None:
        human.enriched_profile = enriched_profile
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _list(
    client: TestClient,
    admin,
    tenant: Tenants,
    marker: str,
    filters: dict | str | None = None,
    **extra_params,
):
    params: dict = {"email": f"flt-{marker}", **extra_params}
    if filters is not None:
        params["filters"] = filters if isinstance(filters, str) else json.dumps(filters)
    return client.get("/api/v1/humans", params=params, headers=_auth(admin, tenant))


def _ids(response) -> set[str]:
    assert response.status_code == 200, response.text
    return {row["id"] for row in response.json()["results"]}


def _one(field: str, op: str, value=None) -> dict:
    return {
        "match": "all",
        "conditions": [{"field": field, "op": op, "value": value}],
    }


@pytest.fixture
def enrichment_presence_world(db: Session, tenant_a: Tenants):
    marker = _marker()
    sql_null = _make_human(db, tenant_a, marker)
    json_null = _make_human(db, tenant_a, marker)
    empty = _make_human(db, tenant_a, marker, enriched_profile={})
    filled = _make_human(
        db, tenant_a, marker, enriched_profile={"headline": "Researcher"}
    )
    # Seed both database representations explicitly: deserialization maps both
    # SQL NULL and JSON null to Python None, but the query must distinguish them.
    for human, value in ((sql_null, null()), (json_null, JSON.NULL)):
        db.exec(
            update(Humans).where(Humans.id == human.id).values(enriched_profile=value)
        )
    db.commit()
    for human, expected in ((sql_null, None), (json_null, "null")):
        assert (
            db.exec(
                select(func.jsonb_typeof(Humans.enriched_profile)).where(
                    Humans.id == human.id
                )
            ).one()
            == expected
        )
    missing_ids = {str(sql_null.id), str(json_null.id)}
    present_ids = {str(empty.id), str(filled.id)}
    return (
        _make_admin(db, tenant_a),
        marker,
        {
            False: missing_ids,
            True: present_ids,
            None: missing_ids | present_ids,
        },
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestHumanListFilters:
    def test_first_name_eq_and_contains(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        marker = _marker()
        admin = _make_admin(db, tenant_a)
        alice = _make_human(db, tenant_a, marker, first_name="Alice")
        bob = _make_human(db, tenant_a, marker, first_name="Bob")

        response = _list(
            client, admin, tenant_a, marker, _one("first_name", "contains", "ali")
        )
        assert _ids(response) == {str(alice.id)}

        response = _list(
            client, admin, tenant_a, marker, _one("first_name", "eq", "Bob")
        )
        assert _ids(response) == {str(bob.id)}

    def test_residence_is_empty_and_not_empty(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        marker = _marker()
        admin = _make_admin(db, tenant_a)
        missing = _make_human(db, tenant_a, marker, residence=None)
        filled = _make_human(db, tenant_a, marker, residence="Lisbon")

        response = _list(client, admin, tenant_a, marker, _one("residence", "is_empty"))
        assert _ids(response) == {str(missing.id)}

        response = _list(
            client, admin, tenant_a, marker, _one("residence", "not_empty")
        )
        assert _ids(response) == {str(filled.id)}

    def test_rating_eq_and_neq(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        marker = _marker()
        admin = _make_admin(db, tenant_a)
        starred = _make_human(db, tenant_a, marker, rating=HumanRating.STAR.value)
        unrated = _make_human(db, tenant_a, marker)

        response = _list(client, admin, tenant_a, marker, _one("rating", "eq", "star"))
        assert _ids(response) == {str(starred.id)}

        response = _list(client, admin, tenant_a, marker, _one("rating", "neq", "star"))
        assert _ids(response) == {str(unrated.id)}

    def test_rating_invalid_value_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        admin = _make_admin(db, tenant_a)

        response = _list(
            client, admin, tenant_a, _marker(), _one("rating", "eq", "superstar")
        )
        assert response.status_code == 422, response.text

    def test_enriched_profile_contains_and_is_empty(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        marker = _marker()
        admin = _make_admin(db, tenant_a)
        enriched = _make_human(
            db,
            tenant_a,
            marker,
            enriched_profile={"headline": "Distributed systems researcher"},
        )
        plain = _make_human(db, tenant_a, marker)

        response = _list(
            client,
            admin,
            tenant_a,
            marker,
            _one("enriched_profile", "contains", "researcher"),
        )
        assert _ids(response) == {str(enriched.id)}

        response = _list(
            client, admin, tenant_a, marker, _one("enriched_profile", "is_empty")
        )
        assert _ids(response) == {str(plain.id)}

        # not_contains also matches humans that were never enriched (NULL).
        response = _list(
            client,
            admin,
            tenant_a,
            marker,
            _one("enriched_profile", "not_contains", "researcher"),
        )
        assert _ids(response) == {str(plain.id)}

    def test_enriched_profile_contains_escapes_like_wildcards(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        marker = _marker()
        admin = _make_admin(db, tenant_a)
        literal = _make_human(
            db,
            tenant_a,
            marker,
            enriched_profile={"headline": "Works 100% remote"},
        )
        _make_human(
            db,
            tenant_a,
            marker,
            enriched_profile={"headline": "Works 100 days remote"},
        )

        response = _list(
            client,
            admin,
            tenant_a,
            marker,
            _one("enriched_profile", "contains", "100% remote"),
        )
        assert _ids(response) == {str(literal.id)}

    def test_match_all_vs_any(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        marker = _marker()
        admin = _make_admin(db, tenant_a)
        both = _make_human(db, tenant_a, marker, first_name="Alice", gender="female")
        only_name = _make_human(db, tenant_a, marker, first_name="Alice", gender="male")
        only_gender = _make_human(
            db, tenant_a, marker, first_name="Bob", gender="female"
        )
        _make_human(db, tenant_a, marker, first_name="Bob", gender="male")

        conditions = [
            {"field": "first_name", "op": "eq", "value": "Alice"},
            {"field": "gender", "op": "eq", "value": "female"},
        ]

        response = _list(
            client, admin, tenant_a, marker, {"match": "all", "conditions": conditions}
        )
        assert _ids(response) == {str(both.id)}

        response = _list(
            client, admin, tenant_a, marker, {"match": "any", "conditions": conditions}
        )
        assert _ids(response) == {
            str(both.id),
            str(only_name.id),
            str(only_gender.id),
        }

    def test_legacy_params_combine_with_filters(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        marker = _marker()
        admin = _make_admin(db, tenant_a)
        match = _make_human(db, tenant_a, marker, first_name="Alice", gender="female")
        _make_human(db, tenant_a, marker, first_name="Alice", gender="male")
        _make_human(db, tenant_a, marker, first_name="Bob", gender="female")

        response = _list(
            client,
            admin,
            tenant_a,
            marker,
            _one("first_name", "eq", "Alice"),
            gender="female",
        )
        assert _ids(response) == {str(match.id)}

    def test_malformed_filters_json_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        admin = _make_admin(db, tenant_a)

        response = _list(client, admin, tenant_a, _marker(), "{not json")
        assert response.status_code == 422, response.text

    def test_unknown_field_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        admin = _make_admin(db, tenant_a)

        response = _list(
            client, admin, tenant_a, _marker(), _one("picture_url", "eq", "x")
        )
        assert response.status_code == 422, response.text

    def test_disallowed_op_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        admin = _make_admin(db, tenant_a)

        response = _list(client, admin, tenant_a, _marker(), _one("email", "is_empty"))
        assert response.status_code == 422, response.text

    def test_empty_conditions_is_noop(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        marker = _marker()
        admin = _make_admin(db, tenant_a)
        first = _make_human(db, tenant_a, marker)
        second = _make_human(db, tenant_a, marker)

        response = _list(
            client, admin, tenant_a, marker, {"match": "all", "conditions": []}
        )
        assert _ids(response) == {str(first.id), str(second.id)}


class TestHumanEnrichmentPresenceFilter:
    @pytest.mark.parametrize("present", (True, False, None))
    def test_legacy_presence_filter_handles_both_null_representations(
        self, client: TestClient, tenant_a: Tenants, enrichment_presence_world, present
    ) -> None:
        admin, marker, expected = enrichment_presence_world
        params = {} if present is None else {"has_enriched_profile": present}
        response = _list(client, admin, tenant_a, marker, **params)
        # Empty objects remain present; None means the filter is omitted.
        assert _ids(response) == expected[present]
        assert response.json()["paging"]["total"] == len(expected[present])

    @pytest.mark.parametrize("present", (True, False))
    def test_legacy_and_advanced_presence_filters_agree(
        self, client: TestClient, tenant_a: Tenants, enrichment_presence_world, present
    ) -> None:
        admin, marker, expected = enrichment_presence_world
        legacy = _list(client, admin, tenant_a, marker, has_enriched_profile=present)
        advanced = _list(
            client,
            admin,
            tenant_a,
            marker,
            _one("enriched_profile", "not_empty" if present else "is_empty"),
        )
        assert _ids(legacy) == _ids(advanced) == expected[present]
        assert legacy.json()["paging"]["total"] == advanced.json()["paging"]["total"]

    @pytest.mark.parametrize("present", (True, False))
    def test_filtered_pagination_keeps_correct_total(
        self, client: TestClient, tenant_a: Tenants, enrichment_presence_world, present
    ) -> None:
        admin, marker, expected = enrichment_presence_world
        response = _list(
            client,
            admin,
            tenant_a,
            marker,
            has_enriched_profile=present,
            skip=1,
            limit=1,
        )
        ids = _ids(response)
        assert len(ids) == 1 and ids <= expected[present]
        assert response.json()["paging"]["total"] == len(expected[present])

    @pytest.mark.parametrize("present", (True, False))
    def test_legacy_presence_filter_still_combines_with_advanced_filters(
        self, client: TestClient, tenant_a: Tenants, enrichment_presence_world, present
    ) -> None:
        admin, marker, _ = enrichment_presence_world
        response = _list(
            client,
            admin,
            tenant_a,
            marker,
            _one("enriched_profile", "is_empty" if present else "not_empty"),
            has_enriched_profile=present,
        )
        assert _ids(response) == set()
        assert response.json()["paging"]["total"] == 0
