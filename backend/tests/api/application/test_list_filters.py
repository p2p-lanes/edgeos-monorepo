"""Complex ``filters`` query param on GET /applications (BO list).

The param carries a JSON filter group ({match, conditions[]}) that is
compiled to one SQL boolean expression and ANDed with the legacy params.
Invalid JSON, unknown fields, or disallowed operators return 422.

Each test creates a fresh popup and filters by popup_id so it is isolated
from the session-scoped shared fixtures (db / tenant_a have no per-test
rollback).
"""

import json
import uuid
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from tests.api.application_review.test_pending_reviews import (
    _auth,
    _make_admin,
    _make_popup,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    status: str = ApplicationStatus.IN_REVIEW.value,
    custom_fields: dict | None = None,
    referral: str | None = None,
    submitted_at: datetime | None = None,
    gender: str | None = None,
) -> Applications:
    human = Humans(
        tenant_id=tenant.id,
        email=f"filters-applicant-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Filters",
        last_name="Applicant",
        gender=gender,
    )
    db.add(human)
    db.flush()

    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=status,
        custom_fields=custom_fields or {},
        referral=referral,
        submitted_at=submitted_at,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _list(
    client: TestClient,
    admin,
    tenant: Tenants,
    popup: Popups,
    filters: dict | str | None = None,
    **extra_params,
):
    params: dict = {"popup_id": str(popup.id), **extra_params}
    if filters is not None:
        params["filters"] = filters if isinstance(filters, str) else json.dumps(filters)
    return client.get(
        "/api/v1/applications", params=params, headers=_auth(admin, tenant)
    )


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


class TestApplicationListFilters:
    def test_status_eq(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        accepted = _make_application(
            db, tenant_a, popup, status=ApplicationStatus.ACCEPTED.value
        )
        _make_application(db, tenant_a, popup)

        response = _list(
            client, admin, tenant_a, popup, _one("status", "eq", "accepted")
        )
        assert _ids(response) == {str(accepted.id)}

    def test_custom_field_eq_and_contains(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        engineer = _make_application(
            db, tenant_a, popup, custom_fields={"role": "Engineer"}
        )
        designer = _make_application(
            db, tenant_a, popup, custom_fields={"role": "Product Designer"}
        )

        response = _list(
            client, admin, tenant_a, popup, _one("custom.role", "eq", "Engineer")
        )
        assert _ids(response) == {str(engineer.id)}

        # contains is case-insensitive
        response = _list(
            client, admin, tenant_a, popup, _one("custom.role", "contains", "design")
        )
        assert _ids(response) == {str(designer.id)}

    def test_match_all_vs_any(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        both = _make_application(
            db,
            tenant_a,
            popup,
            status=ApplicationStatus.ACCEPTED.value,
            custom_fields={"role": "Engineer"},
        )
        only_status = _make_application(
            db, tenant_a, popup, status=ApplicationStatus.ACCEPTED.value
        )
        only_role = _make_application(
            db, tenant_a, popup, custom_fields={"role": "Engineer"}
        )
        _make_application(db, tenant_a, popup)

        conditions = [
            {"field": "status", "op": "eq", "value": "accepted"},
            {"field": "custom.role", "op": "eq", "value": "Engineer"},
        ]

        response = _list(
            client, admin, tenant_a, popup, {"match": "all", "conditions": conditions}
        )
        assert _ids(response) == {str(both.id)}

        response = _list(
            client, admin, tenant_a, popup, {"match": "any", "conditions": conditions}
        )
        assert _ids(response) == {str(both.id), str(only_status.id), str(only_role.id)}

    def test_custom_field_is_empty(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        missing = _make_application(db, tenant_a, popup, custom_fields={})
        blank = _make_application(db, tenant_a, popup, custom_fields={"role": ""})
        filled = _make_application(
            db, tenant_a, popup, custom_fields={"role": "Engineer"}
        )

        response = _list(
            client, admin, tenant_a, popup, _one("custom.role", "is_empty")
        )
        assert _ids(response) == {str(missing.id), str(blank.id)}

        response = _list(
            client, admin, tenant_a, popup, _one("custom.role", "not_empty")
        )
        assert _ids(response) == {str(filled.id)}

    def test_submitted_at_before_and_after(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        early = _make_application(
            db, tenant_a, popup, submitted_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
        )
        late = _make_application(
            db, tenant_a, popup, submitted_at=datetime(2026, 3, 20, 12, 0, tzinfo=UTC)
        )
        _make_application(db, tenant_a, popup, submitted_at=None)

        response = _list(
            client, admin, tenant_a, popup, _one("submitted_at", "before", "2026-03-10")
        )
        assert _ids(response) == {str(early.id)}

        response = _list(
            client, admin, tenant_a, popup, _one("submitted_at", "after", "2026-03-10")
        )
        assert _ids(response) == {str(late.id)}

    def test_malformed_filters_json_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(client, admin, tenant_a, popup, "{not json")
        assert response.status_code == 422, response.text

    def test_unknown_field_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(client, admin, tenant_a, popup, _one("credit", "eq", "100"))
        assert response.status_code == 422, response.text

    def test_disallowed_op_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(
            client, admin, tenant_a, popup, _one("status", "contains", "acc")
        )
        assert response.status_code == 422, response.text

    def test_legacy_params_combine_with_filters(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        match = _make_application(
            db,
            tenant_a,
            popup,
            status=ApplicationStatus.ACCEPTED.value,
            referral="alice",
        )
        _make_application(db, tenant_a, popup, status=ApplicationStatus.ACCEPTED.value)
        _make_application(db, tenant_a, popup, referral="alice")

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            _one("referral", "eq", "alice"),
            status_filter=ApplicationStatus.ACCEPTED.value,
        )
        assert _ids(response) == {str(match.id)}

    def test_human_field_filter_combined_with_search(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        # gender lives on Humans; combined with search this must join once.
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        match = _make_application(db, tenant_a, popup, gender="female")
        _make_application(db, tenant_a, popup, gender="male")

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            _one("gender", "eq", "female"),
            search="Filters",
        )
        assert _ids(response) == {str(match.id)}

    def test_empty_conditions_is_noop(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        first = _make_application(db, tenant_a, popup)
        second = _make_application(db, tenant_a, popup)

        response = _list(
            client, admin, tenant_a, popup, {"match": "all", "conditions": []}
        )
        assert _ids(response) == {str(first.id), str(second.id)}
