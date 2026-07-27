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

from fastapi.testclient import TestClient
from sqlmodel import Session

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
