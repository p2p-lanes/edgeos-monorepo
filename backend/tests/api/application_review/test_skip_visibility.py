"""Per-reviewer skip visibility on the applications list and detail endpoints.

skipped_by_me / my_skip_reason must reflect only the CURRENT user's skip:
reviewer A skipping an application never leaks into reviewer B's view, and
un-skipping resets both fields.

Each test creates a fresh popup and filters by popup_id so it is isolated
from the session-scoped shared fixtures (db / tenant_a have no per-test
rollback).
"""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.tenant.models import Tenants
from tests.api.application_review.test_pending_reviews import (
    _auth,
    _make_admin,
    _make_in_review_application,
    _make_popup,
)


def _skip(client: TestClient, app_id, reviewer, tenant, reason=None) -> None:
    response = client.post(
        f"/api/v1/applications/{app_id}/skip",
        json={"reason": reason},
        headers=_auth(reviewer, tenant),
    )
    assert response.status_code == 201, response.text


def _unskip(client: TestClient, app_id, reviewer, tenant) -> None:
    response = client.delete(
        f"/api/v1/applications/{app_id}/skip",
        headers=_auth(reviewer, tenant),
    )
    assert response.status_code == 204, response.text


def _list_row(client: TestClient, reviewer, tenant, popup, app_id) -> dict:
    response = client.get(
        "/api/v1/applications",
        params={"popup_id": str(popup.id)},
        headers=_auth(reviewer, tenant),
    )
    assert response.status_code == 200, response.text
    rows = [r for r in response.json()["results"] if r["id"] == str(app_id)]
    assert rows, "Application must appear in the list"
    return rows[0]


def _get_detail(client: TestClient, reviewer, tenant, app_id) -> dict:
    response = client.get(
        f"/api/v1/applications/{app_id}",
        headers=_auth(reviewer, tenant),
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestSkipVisibility:
    def test_list_shows_skip_only_to_the_skipping_reviewer(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        reviewer_a = _make_admin(db, tenant_a)
        reviewer_b = _make_admin(db, tenant_a)
        application = _make_in_review_application(db, tenant_a, popup)

        _skip(
            client, application.id, reviewer_a, tenant_a, reason="Conflict of interest"
        )

        row_a = _list_row(client, reviewer_a, tenant_a, popup, application.id)
        assert row_a["skipped_by_me"] is True
        assert row_a["my_skip_reason"] == "Conflict of interest"

        row_b = _list_row(client, reviewer_b, tenant_a, popup, application.id)
        assert row_b["skipped_by_me"] is False
        assert row_b["my_skip_reason"] is None

    def test_get_application_shows_skip_only_to_the_skipping_reviewer(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        reviewer_a = _make_admin(db, tenant_a)
        reviewer_b = _make_admin(db, tenant_a)
        application = _make_in_review_application(db, tenant_a, popup)

        _skip(
            client, application.id, reviewer_a, tenant_a, reason="Know them personally"
        )

        detail_a = _get_detail(client, reviewer_a, tenant_a, application.id)
        assert detail_a["skipped_by_me"] is True
        assert detail_a["my_skip_reason"] == "Know them personally"

        detail_b = _get_detail(client, reviewer_b, tenant_a, application.id)
        assert detail_b["skipped_by_me"] is False
        assert detail_b["my_skip_reason"] is None

    def test_unskip_resets_flags(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        reviewer = _make_admin(db, tenant_a)
        application = _make_in_review_application(db, tenant_a, popup)

        _skip(client, application.id, reviewer, tenant_a, reason="Too busy")
        _unskip(client, application.id, reviewer, tenant_a)

        row = _list_row(client, reviewer, tenant_a, popup, application.id)
        assert row["skipped_by_me"] is False
        assert row["my_skip_reason"] is None

        detail = _get_detail(client, reviewer, tenant_a, application.id)
        assert detail["skipped_by_me"] is False
        assert detail["my_skip_reason"] is None
