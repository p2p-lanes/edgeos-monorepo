"""Tests for GET /applications/pending-review (find_pending_review CRUD).

The reviewed-by-me exclusion and pagination run in SQL: an application the
current reviewer already reviewed is excluded, one reviewed only by a
different reviewer still appears, and paging.total reflects the real
pending count across skip/limit pages.

Each test creates a fresh popup and filters by popup_id so it is isolated
from the session-scoped shared fixtures (db / tenant_a have no per-test
rollback).
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.application_review.models import ApplicationReviews
from app.api.application_review.schemas import ReviewDecision
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _auth(user: Users, tenant: Tenants) -> dict[str, str]:
    token = create_access_token(subject=user.id, token_type="user")
    return {"Authorization": f"Bearer {token}", "X-Tenant-Id": str(tenant.id)}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name="Pending Reviews Popup",
        slug=f"pending-reviews-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_admin(db: Session, tenant: Tenants) -> Users:
    user = Users(
        email=f"pending-reviewer-{uuid.uuid4().hex[:8]}@test.com",
        role=UserRole.ADMIN,
        tenant_id=tenant.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_in_review_application(
    db: Session, tenant: Tenants, popup: Popups
) -> Applications:
    """IN_REVIEW application with its own human (unique human+popup constraint)."""
    human = Humans(
        tenant_id=tenant.id,
        email=f"pending-applicant-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Pending",
        last_name="Applicant",
    )
    db.add(human)
    db.flush()

    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.IN_REVIEW.value,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _make_review(
    db: Session,
    tenant: Tenants,
    application: Applications,
    reviewer: Users,
) -> None:
    """Insert a review row directly so the application status stays IN_REVIEW."""
    db.add(
        ApplicationReviews(
            application_id=application.id,
            reviewer_id=reviewer.id,
            tenant_id=tenant.id,
            decision=ReviewDecision.NO,
        )
    )
    db.commit()


def _get_pending(
    client: TestClient,
    reviewer: Users,
    tenant: Tenants,
    popup: Popups,
    **params,
) -> dict:
    response = client.get(
        "/api/v1/applications/pending-review",
        params={"popup_id": str(popup.id), **params},
        headers=_auth(reviewer, tenant),
    )
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestListPendingReviews:
    def test_excludes_only_apps_reviewed_by_current_reviewer(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        """Reviewed-by-me is excluded; reviewed-by-someone-else still appears."""
        popup = _make_popup(db, tenant_a)
        reviewer = _make_admin(db, tenant_a)
        other_reviewer = _make_admin(db, tenant_a)

        app_mine = _make_in_review_application(db, tenant_a, popup)
        app_other = _make_in_review_application(db, tenant_a, popup)
        app_fresh = _make_in_review_application(db, tenant_a, popup)

        _make_review(db, tenant_a, app_mine, reviewer)
        _make_review(db, tenant_a, app_other, other_reviewer)

        data = _get_pending(client, reviewer, tenant_a, popup)
        ids = {r["id"] for r in data["results"]}

        assert str(app_mine.id) not in ids, (
            "Application already reviewed by the current reviewer must be excluded"
        )
        assert str(app_other.id) in ids, (
            "Application reviewed only by a different reviewer must still appear"
        )
        assert str(app_fresh.id) in ids
        assert data["paging"]["total"] == 2

    def test_pagination_total_reflects_real_pending_count(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        """total counts all pending apps while pages respect skip/limit."""
        popup = _make_popup(db, tenant_a)
        reviewer = _make_admin(db, tenant_a)

        apps = [_make_in_review_application(db, tenant_a, popup) for _ in range(3)]
        expected_ids = {str(a.id) for a in apps}

        page_1 = _get_pending(client, reviewer, tenant_a, popup, skip=0, limit=2)
        page_2 = _get_pending(client, reviewer, tenant_a, popup, skip=2, limit=2)

        assert page_1["paging"]["total"] == 3
        assert page_2["paging"]["total"] == 3
        assert len(page_1["results"]) == 2
        assert len(page_2["results"]) == 1

        ids_1 = {r["id"] for r in page_1["results"]}
        ids_2 = {r["id"] for r in page_2["results"]}
        assert ids_1.isdisjoint(ids_2), "Pages must not overlap"
        assert ids_1 | ids_2 == expected_ids
