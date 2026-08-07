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
from app.api.application_review.models import ApplicationReviewSkips
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from tests._flow_helpers import application_flow_id
from tests.api.application_review.test_pending_reviews import (
    _auth,
    _make_admin,
    _make_popup,
    _make_review,
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
    residence: str | None = None,
    rating: str | None = None,
    scholarship_request: bool = False,
    scholarship_video_url: str | None = None,
) -> Applications:
    human = Humans(
        tenant_id=tenant.id,
        email=f"filters-applicant-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Filters",
        last_name="Applicant",
        gender=gender,
        residence=residence,
        **({"rating": rating} if rating is not None else {}),
    )
    db.add(human)
    db.flush()

    application = Applications(
        sales_flow_id=application_flow_id(db, popup.id),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=status,
        custom_fields=custom_fields or {},
        referral=referral,
        submitted_at=submitted_at,
        scholarship_request=scholarship_request,
        scholarship_video_url=scholarship_video_url,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _make_skip(
    db: Session,
    tenant: Tenants,
    application: Applications,
    reviewer: Users,
) -> None:
    db.add(
        ApplicationReviewSkips(
            application_id=application.id,
            reviewer_id=reviewer.id,
            tenant_id=tenant.id,
        )
    )
    db.commit()


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

    def test_residence_eq_and_contains(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        # residence lives on Humans; eq is exact, contains is case-insensitive.
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        exact = _make_application(db, tenant_a, popup, residence="Argentina")
        partial = _make_application(
            db, tenant_a, popup, residence="Buenos Aires, Argentina"
        )
        _make_application(db, tenant_a, popup, residence="Lisbon, Portugal")

        response = _list(
            client, admin, tenant_a, popup, _one("residence", "eq", "Argentina")
        )
        assert _ids(response) == {str(exact.id)}

        response = _list(
            client, admin, tenant_a, popup, _one("residence", "contains", "argentina")
        )
        assert _ids(response) == {str(exact.id), str(partial.id)}

    def test_rating_eq_and_neq(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        # rating lives on Humans and defaults to "unrated" (never NULL).
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        flagged = _make_application(db, tenant_a, popup, rating="red_flag")
        unrated = _make_application(db, tenant_a, popup)

        response = _list(
            client, admin, tenant_a, popup, _one("rating", "eq", "red_flag")
        )
        assert _ids(response) == {str(flagged.id)}

        response = _list(
            client, admin, tenant_a, popup, _one("rating", "neq", "red_flag")
        )
        assert _ids(response) == {str(unrated.id)}

        response = _list(
            client, admin, tenant_a, popup, _one("rating", "eq", "not-a-rating")
        )
        assert response.status_code == 422

    def test_scholarship_video_is_empty(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        # Scholarship requests without a video are incomplete submissions.
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        incomplete = _make_application(db, tenant_a, popup, scholarship_request=True)
        _make_application(
            db,
            tenant_a,
            popup,
            scholarship_request=True,
            scholarship_video_url="https://example.com/video",
        )

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            {
                "match": "all",
                "conditions": [
                    {"field": "scholarship_request", "op": "eq", "value": True},
                    {"field": "scholarship_video_url", "op": "is_empty", "value": None},
                ],
            },
        )
        assert _ids(response) == {str(incomplete.id)}

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

    def test_skipped_by_me_is_per_reviewer(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        reviewer_a = _make_admin(db, tenant_a)
        reviewer_b = _make_admin(db, tenant_a)
        skipped = _make_application(db, tenant_a, popup)
        other = _make_application(db, tenant_a, popup)
        _make_skip(db, tenant_a, skipped, reviewer_a)

        response = _list(
            client, reviewer_a, tenant_a, popup, _one("skipped_by_me", "eq", True)
        )
        assert _ids(response) == {str(skipped.id)}

        # The skip belongs to reviewer A only; B sees no skipped apps.
        response = _list(
            client, reviewer_b, tenant_a, popup, _one("skipped_by_me", "eq", True)
        )
        assert _ids(response) == set()

        response = _list(
            client, reviewer_a, tenant_a, popup, _one("skipped_by_me", "eq", False)
        )
        assert _ids(response) == {str(other.id)}

    def test_reviewed_by_me_is_per_reviewer(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        reviewer_a = _make_admin(db, tenant_a)
        reviewer_b = _make_admin(db, tenant_a)
        reviewed = _make_application(db, tenant_a, popup)
        other = _make_application(db, tenant_a, popup)
        _make_review(db, tenant_a, reviewed, reviewer_a)

        response = _list(
            client, reviewer_a, tenant_a, popup, _one("reviewed_by_me", "eq", True)
        )
        assert _ids(response) == {str(reviewed.id)}

        response = _list(
            client, reviewer_b, tenant_a, popup, _one("reviewed_by_me", "eq", True)
        )
        assert _ids(response) == set()

        response = _list(
            client, reviewer_a, tenant_a, popup, _one("reviewed_by_me", "eq", False)
        )
        assert _ids(response) == {str(other.id)}

    def test_my_pending_work_combined_filter(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        # "My pending work": in review AND not yet reviewed by me.
        popup = _make_popup(db, tenant_a)
        reviewer = _make_admin(db, tenant_a)
        pending = _make_application(db, tenant_a, popup)
        reviewed = _make_application(db, tenant_a, popup)
        _make_review(db, tenant_a, reviewed, reviewer)
        _make_application(db, tenant_a, popup, status=ApplicationStatus.ACCEPTED.value)

        response = _list(
            client,
            reviewer,
            tenant_a,
            popup,
            {
                "match": "all",
                "conditions": [
                    {"field": "status", "op": "eq", "value": "in review"},
                    {"field": "reviewed_by_me", "op": "eq", "value": False},
                ],
            },
        )
        assert _ids(response) == {str(pending.id)}

    def test_reviewed_by_eq_and_neq(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        reviewer_a = _make_admin(db, tenant_a)
        reviewer_b = _make_admin(db, tenant_a)
        reviewed_by_a = _make_application(db, tenant_a, popup)
        reviewed_by_b = _make_application(db, tenant_a, popup)
        unreviewed = _make_application(db, tenant_a, popup)
        _make_review(db, tenant_a, reviewed_by_a, reviewer_a)
        _make_review(db, tenant_a, reviewed_by_b, reviewer_b)

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            _one("reviewed_by", "eq", str(reviewer_a.id)),
        )
        assert _ids(response) == {str(reviewed_by_a.id)}

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            _one("reviewed_by", "neq", str(reviewer_a.id)),
        )
        assert _ids(response) == {str(reviewed_by_b.id), str(unreviewed.id)}

    def test_reviewed_by_combined_with_status(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        reviewer = _make_admin(db, tenant_a)
        match = _make_application(
            db, tenant_a, popup, status=ApplicationStatus.ACCEPTED.value
        )
        in_review = _make_application(db, tenant_a, popup)
        _make_review(db, tenant_a, match, reviewer)
        _make_review(db, tenant_a, in_review, reviewer)
        _make_application(db, tenant_a, popup, status=ApplicationStatus.ACCEPTED.value)

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            {
                "match": "all",
                "conditions": [
                    {"field": "status", "op": "eq", "value": "accepted"},
                    {"field": "reviewed_by", "op": "eq", "value": str(reviewer.id)},
                ],
            },
        )
        assert _ids(response) == {str(match.id)}

    def test_reviewed_by_invalid_uuid_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(
            client, admin, tenant_a, popup, _one("reviewed_by", "eq", "not-a-uuid")
        )
        assert response.status_code == 422, response.text

    def test_reviewed_by_disallowed_op_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            _one("reviewed_by", "contains", str(uuid.uuid4())),
        )
        assert response.status_code == 422, response.text

    def test_virtual_field_non_boolean_value_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(
            client, admin, tenant_a, popup, _one("skipped_by_me", "eq", "yes")
        )
        assert response.status_code == 422, response.text

        response = _list(
            client, admin, tenant_a, popup, _one("reviewed_by_me", "contains", True)
        )
        assert response.status_code == 422, response.text
