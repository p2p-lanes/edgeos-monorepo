"""Every application-list branch must batch its response relationships."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session

from app.api.attendee.models import Attendees
from app.api.tenant.models import Tenants
from tests.api.application.test_list_filters import _make_application
from tests.api.application_review.test_pending_reviews import (
    _auth,
    _make_admin,
    _make_popup,
    _make_review,
)


@pytest.mark.parametrize("branch", ["unfiltered", "popup", "human"])
def test_application_list_batches_relationships(
    client: TestClient, db: Session, tenant_a: Tenants, branch: str
) -> None:
    admin = _make_admin(db, tenant_a)
    popup = _make_popup(db, tenant_a)
    applications = []
    for index in range(100):
        # Human listings need multiple flows to respect application uniqueness.
        target = _make_popup(db, tenant_a) if branch == "human" else popup
        application = _make_application(db, tenant_a, target)
        if branch == "human" and applications:
            application.human_id = applications[0].human_id
        db.add(application)
        db.add(
            Attendees(
                tenant_id=tenant_a.id,
                popup_id=target.id,
                application_id=application.id,
                human_id=application.human_id,
                name=f"Applicant {index}",
            )
        )
        db.commit()
        _make_review(db, tenant_a, application, admin)
        applications.append(application)

    params = {}
    if branch == "popup":
        params["popup_id"] = str(popup.id)
    elif branch == "human":
        params["human_id"] = str(applications[0].human_id)
    headers = _auth(admin, tenant_a)
    lazy_loads = []
    relationship_queries = []
    query_counts = []
    first_row = None
    total = None

    def record_lazy_load(execute_state):
        if execute_state.is_relationship_load:
            relationship_queries.append(str(execute_state.statement))
            if execute_state.lazy_loaded_from is not None:
                lazy_loads.append(str(execute_state.statement))

    event.listen(Session, "do_orm_execute", record_lazy_load)
    try:
        for limit in (1, 100):
            relationship_queries.clear()
            response = client.get(
                "/api/v1/applications",
                params={**params, "limit": limit},
                headers=headers,
            )
            assert response.status_code == 200, response.text
            payload = response.json()
            query_counts.append(len(relationship_queries))
            assert len(payload["results"]) == limit
            assert payload["paging"]["offset"] == 0
            assert payload["paging"]["limit"] == limit
            assert payload["paging"]["total"] >= 100
            if first_row is None:
                first_row = payload["results"][0]
                total = payload["paging"]["total"]
            else:
                assert payload["results"][0] == first_row
                assert payload["paging"]["total"] == total
            for row in payload["results"]:
                assert row["human_id"]
                assert len(row["attendees"]) == 1
    finally:
        event.remove(Session, "do_orm_execute", record_lazy_load)
    assert not lazy_loads, lazy_loads
    assert query_counts[0] == query_counts[1], query_counts
