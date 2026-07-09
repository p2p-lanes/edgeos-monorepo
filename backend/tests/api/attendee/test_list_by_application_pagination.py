"""Tests for GET /attendees?application_id= pagination (find_by_application).

The CRUD paginates in SQL with a stable ORDER BY (created_at, id): total is
the full attendee count for the application, page size respects limit, and
pages are disjoint so page 2 never repeats page 1.

Each test creates a fresh popup/application so it is isolated from the
session-scoped shared fixtures (db / tenant_a have no per-test rollback).
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token


def _auth(user: Users) -> dict[str, str]:
    token = create_access_token(subject=user.id, token_type="user")
    return {"Authorization": f"Bearer {token}"}


def _make_application(db: Session, tenant: Tenants) -> Applications:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name="Attendee Pagination Popup",
        slug=f"attendee-pagination-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.flush()

    human = Humans(
        tenant_id=tenant.id,
        email=f"attendee-pagination-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Page",
        last_name="Owner",
    )
    db.add(human)
    db.flush()

    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _make_attendees(
    db: Session, tenant: Tenants, application: Applications, count: int
) -> list[Attendees]:
    attendees = [
        Attendees(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            popup_id=application.popup_id,
            application_id=application.id,
            name=f"Attendee {i}",
        )
        for i in range(count)
    ]
    db.add_all(attendees)
    db.commit()
    return attendees


class TestListAttendeesByApplicationPagination:
    def test_pagination_is_deterministic_and_total_is_full_count(
        self,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
        client: TestClient,
    ) -> None:
        application = _make_application(db, tenant_a)
        attendees = _make_attendees(db, tenant_a, application, count=5)
        expected_ids = {str(a.id) for a in attendees}

        def get_page(skip: int, limit: int) -> dict:
            response = client.get(
                "/api/v1/attendees",
                params={
                    "application_id": str(application.id),
                    "skip": skip,
                    "limit": limit,
                },
                headers=_auth(admin_user_tenant_a),
            )
            assert response.status_code == 200, response.text
            return response.json()

        page_1 = get_page(skip=0, limit=3)
        page_2 = get_page(skip=3, limit=3)

        # total is the full count even when the page is smaller
        assert page_1["paging"]["total"] == 5
        assert page_2["paging"]["total"] == 5
        assert len(page_1["results"]) == 3
        assert len(page_2["results"]) == 2

        ids_1 = {r["id"] for r in page_1["results"]}
        ids_2 = {r["id"] for r in page_2["results"]}
        assert ids_1.isdisjoint(ids_2), (
            "Page 2 must not repeat page 1 rows — ordering must be deterministic"
        )
        assert ids_1 | ids_2 == expected_ids

        # Re-reading page 1 returns the same rows (stable ORDER BY)
        assert {r["id"] for r in get_page(skip=0, limit=3)["results"]} == ids_1
