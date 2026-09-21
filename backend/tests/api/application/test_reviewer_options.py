import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup_reviewer.crud import popup_reviewers_crud
from app.api.popup_reviewer.schemas import PopupReviewerCreate
from app.api.tenant.models import Tenants
from tests._flow_helpers import application_flow_id
from tests.api.application.test_list_filters import _make_application
from tests.api.application_review.test_pending_reviews import (
    _auth,
    _make_admin,
    _make_popup,
    _make_review,
)


@pytest.mark.parametrize("flow_scoped", [False, True])
def test_configured_reviewer_is_available_before_first_vote(
    db: Session, tenant_a: Tenants, client: TestClient, flow_scoped: bool
) -> None:
    popup = _make_popup(db, tenant_a)
    reviewer = _make_admin(db, tenant_a)
    assignment = popup_reviewers_crud.create_reviewer(
        db,
        popup.id,
        tenant_a.id,
        PopupReviewerCreate(
            user_id=reviewer.id,
            sales_flow_id=application_flow_id(db, popup.id) if flow_scoped else None,
        ),
    )
    response = client.get(
        "/api/v1/applications/reviewers",
        params={"popup_id": str(popup.id)},
        headers=_auth(reviewer, tenant_a),
    )
    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "id": str(reviewer.id),
            "full_name": reviewer.full_name,
            "email": reviewer.email,
        }
    ]

    popup_reviewers_crud.delete_reviewer(db, assignment)
    response = client.get(
        "/api/v1/applications/reviewers",
        params={"popup_id": str(popup.id)},
        headers=_auth(reviewer, tenant_a),
    )
    assert response.status_code == 200, response.text
    assert response.json() == []


def test_reviewer_options_deduplicate_assignments_and_preserve_past_voters(
    db: Session, tenant_a: Tenants, client: TestClient
) -> None:
    popup = _make_popup(db, tenant_a)
    reviewer = _make_admin(db, tenant_a)
    past_reviewer = _make_admin(db, tenant_a)
    application = _make_application(db, tenant_a, popup)
    _make_review(db, tenant_a, application, reviewer)
    _make_review(db, tenant_a, application, past_reviewer)
    for flow_id in (None, application.sales_flow_id):
        popup_reviewers_crud.create_reviewer(
            db,
            popup.id,
            tenant_a.id,
            PopupReviewerCreate(user_id=reviewer.id, sales_flow_id=flow_id),
        )
    response = client.get(
        "/api/v1/applications/reviewers",
        params={"popup_id": str(popup.id)},
        headers=_auth(reviewer, tenant_a),
    )
    assert response.status_code == 200, response.text
    assert {row["id"] for row in response.json()} == {
        str(reviewer.id),
        str(past_reviewer.id),
    }
    assert len(response.json()) == 2


def test_reviewer_options_are_scoped_to_popup_and_tenant(
    db: Session, tenant_a: Tenants, tenant_b: Tenants, client: TestClient
) -> None:
    popup = _make_popup(db, tenant_a)
    admin = _make_admin(db, tenant_a)
    other_popups = [_make_popup(db, tenant_a), _make_popup(db, tenant_b)]
    for other_popup, tenant in zip(other_popups, (tenant_a, tenant_b), strict=True):
        reviewer = _make_admin(db, tenant)
        popup_reviewers_crud.create_reviewer(
            db, other_popup.id, tenant.id, PopupReviewerCreate(user_id=reviewer.id)
        )
    for popup_id in (popup.id, other_popups[1].id):
        response = client.get(
            "/api/v1/applications/reviewers",
            params={"popup_id": str(popup_id)},
            headers=_auth(admin, tenant_a),
        )
        assert response.status_code == 200, response.text
        assert response.json() == []
