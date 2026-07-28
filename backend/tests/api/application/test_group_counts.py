"""GET /applications/group-counts (BO grouped views).

One row per distinct value of the group field among the popup's
applications that match filters+search, plus a None bucket where the
field is NULL or empty. Rows come back ordered by count descending.

Each test creates a fresh popup and scopes by popup_id so it is isolated
from the session-scoped shared fixtures (db / tenant_a have no per-test
rollback).
"""

import json

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.schemas import ApplicationStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from tests.api.application.test_list_filters import (
    _ids,
    _list,
    _make_application,
    _one,
)
from tests.api.application_review.test_pending_reviews import (
    _auth,
    _make_admin,
    _make_popup,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _group_counts(
    client: TestClient,
    admin,
    tenant: Tenants,
    popup: Popups,
    group_by: str,
    filters: dict | str | None = None,
    **extra_params,
):
    params: dict = {"popup_id": str(popup.id), "group_by": group_by, **extra_params}
    if filters is not None:
        params["filters"] = filters if isinstance(filters, str) else json.dumps(filters)
    return client.get(
        "/api/v1/applications/group-counts",
        params=params,
        headers=_auth(admin, tenant),
    )


def _buckets(response) -> dict[str | None, int]:
    assert response.status_code == 200, response.text
    return {row["value"]: row["count"] for row in response.json()}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestApplicationGroupCounts:
    def test_group_by_status(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        _make_application(db, tenant_a, popup)
        _make_application(db, tenant_a, popup)
        _make_application(db, tenant_a, popup, status=ApplicationStatus.ACCEPTED.value)

        response = _group_counts(client, admin, tenant_a, popup, "status")
        assert _buckets(response) == {"in review": 2, "accepted": 1}
        # Ordered by count descending in SQL.
        assert response.json()[0]["value"] == "in review"

    def test_group_by_custom_field_null_bucket(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        # Missing key and empty string land in the same None bucket.
        _make_application(db, tenant_a, popup, custom_fields={})
        _make_application(db, tenant_a, popup, custom_fields={"role": ""})
        _make_application(db, tenant_a, popup, custom_fields={"role": "Engineer"})

        response = _group_counts(client, admin, tenant_a, popup, "custom.role")
        assert _buckets(response) == {None: 2, "Engineer": 1}

    def test_counts_respect_filters(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        _make_application(db, tenant_a, popup, custom_fields={"role": "Engineer"})
        _make_application(
            db,
            tenant_a,
            popup,
            status=ApplicationStatus.ACCEPTED.value,
            custom_fields={"role": "Engineer"},
        )

        response = _group_counts(
            client,
            admin,
            tenant_a,
            popup,
            "custom.role",
            filters=_one("status", "eq", "in review"),
        )
        assert _buckets(response) == {"Engineer": 1}

    def test_counts_respect_search(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        match = _make_application(db, tenant_a, popup)
        _make_application(db, tenant_a, popup)
        match_email = db.get(Humans, match.human_id).email

        response = _group_counts(
            client, admin, tenant_a, popup, "status", search=match_email
        )
        assert _buckets(response) == {"in review": 1}

    def test_unsupported_group_by_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _group_counts(client, admin, tenant_a, popup, "credit")
        assert response.status_code == 422, response.text
        assert "not supported" in response.json()["detail"]

        # An empty custom field name is not a valid group either.
        response = _group_counts(client, admin, tenant_a, popup, "custom.")
        assert response.status_code == 422, response.text

    def test_group_by_gender_with_search(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        # gender lives on Humans; combined with search the join must happen
        # exactly once.
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        _make_application(db, tenant_a, popup, gender="female")
        _make_application(db, tenant_a, popup, gender="female")
        _make_application(db, tenant_a, popup, gender="male")
        _make_application(db, tenant_a, popup)

        response = _group_counts(
            client, admin, tenant_a, popup, "gender", search="Filters"
        )
        assert _buckets(response) == {"female": 2, "male": 1, None: 1}

    def test_parent_scope_counts_within_one_bucket(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        # Subgrouped views count the subgroup field inside one expanded
        # parent group only.
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        accepted = ApplicationStatus.ACCEPTED.value
        _make_application(db, tenant_a, popup, status=accepted, gender="female")
        _make_application(db, tenant_a, popup, status=accepted, gender="female")
        _make_application(db, tenant_a, popup, status=accepted, gender="male")
        _make_application(db, tenant_a, popup, gender="female")

        response = _group_counts(
            client,
            admin,
            tenant_a,
            popup,
            "gender",
            parent_group_by="status",
            parent_group_value=accepted,
        )
        assert _buckets(response) == {"female": 2, "male": 1}

    def test_parent_scope_same_field_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _group_counts(
            client, admin, tenant_a, popup, "status", parent_group_by="status"
        )
        assert response.status_code == 422


class TestApplicationListGroupScope:
    """GET /applications with group_by/group_value (rows of one bucket)."""

    def test_group_value_scopes_the_list(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        accepted = _make_application(
            db, tenant_a, popup, status=ApplicationStatus.ACCEPTED.value
        )
        _make_application(db, tenant_a, popup)

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            group_by="status",
            group_value="accepted",
        )
        assert _ids(response) == {str(accepted.id)}

    def test_sub_group_scope_narrows_to_one_subgroup(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        accepted = ApplicationStatus.ACCEPTED.value
        match = _make_application(db, tenant_a, popup, status=accepted, gender="female")
        _make_application(db, tenant_a, popup, status=accepted, gender="male")
        _make_application(db, tenant_a, popup, gender="female")

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            group_by="status",
            group_value="accepted",
            sub_group_by="gender",
            sub_group_value="female",
        )
        assert _ids(response) == {str(match.id)}

    def test_sub_group_same_field_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(
            client, admin, tenant_a, popup, group_by="status", sub_group_by="status"
        )
        assert response.status_code == 422

    def test_match_any_filters_stay_inside_the_group(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        # The motivating case: an OR filter group must not leak rows outside
        # the group scope, so the scope is ANDed rather than appended as one
        # more OR condition.
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        in_group_role = _make_application(
            db,
            tenant_a,
            popup,
            status=ApplicationStatus.ACCEPTED.value,
            custom_fields={"role": "Engineer"},
        )
        in_group_referral = _make_application(
            db,
            tenant_a,
            popup,
            status=ApplicationStatus.ACCEPTED.value,
            referral="alice",
        )
        # In the group but matching neither condition.
        _make_application(
            db,
            tenant_a,
            popup,
            status=ApplicationStatus.ACCEPTED.value,
            custom_fields={"role": "Designer"},
        )
        # Matches a condition but sits outside the group — must not leak in.
        _make_application(db, tenant_a, popup, custom_fields={"role": "Engineer"})

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            filters={
                "match": "any",
                "conditions": [
                    {"field": "custom.role", "op": "eq", "value": "Engineer"},
                    {"field": "referral", "op": "eq", "value": "alice"},
                ],
            },
            group_by="status",
            group_value="accepted",
        )
        assert _ids(response) == {str(in_group_role.id), str(in_group_referral.id)}

    def test_null_bucket_without_group_value(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        missing = _make_application(db, tenant_a, popup, custom_fields={})
        blank = _make_application(db, tenant_a, popup, custom_fields={"role": ""})
        _make_application(db, tenant_a, popup, custom_fields={"role": "Engineer"})

        response = _list(client, admin, tenant_a, popup, group_by="custom.role")
        assert _ids(response) == {str(missing.id), str(blank.id)}

    def test_group_value_without_group_by_is_ignored(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        one = _make_application(db, tenant_a, popup)
        two = _make_application(
            db, tenant_a, popup, status=ApplicationStatus.ACCEPTED.value
        )

        response = _list(client, admin, tenant_a, popup, group_value="accepted")
        assert _ids(response) == {str(one.id), str(two.id)}

    def test_group_by_gender_with_search_joins_once(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        # gender lives on Humans; combined with search the join must happen
        # exactly once.
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        match = _make_application(db, tenant_a, popup, gender="female")
        _make_application(db, tenant_a, popup, gender="male")
        _make_application(db, tenant_a, popup)

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            search="Filters",
            group_by="gender",
            group_value="female",
        )
        assert _ids(response) == {str(match.id)}

    def test_unsupported_group_by_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(client, admin, tenant_a, popup, group_by="credit")
        assert response.status_code == 422, response.text
        assert "not supported" in response.json()["detail"]
