import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application_review.crud import application_reviews_crud
from app.api.application_review.schemas import ApplicationReviewCreate, ReviewDecision
from app.api.tenant.models import Tenants
from tests.api.application.test_group_counts import _buckets, _group_counts
from tests.api.application.test_list_filters import _ids, _list, _make_application, _one
from tests.api.application_review.test_pending_reviews import _make_admin, _make_popup


@pytest.mark.parametrize("decision", list(ReviewDecision))
def test_reviewer_and_vote_filters_match_the_same_review(
    db: Session,
    tenant_a: Tenants,
    client: TestClient,
    decision: ReviewDecision,
) -> None:
    popup = _make_popup(db, tenant_a)
    admin = _make_admin(db, tenant_a)
    sophie = _make_admin(db, tenant_a)
    other = _make_admin(db, tenant_a)
    sophie_vote = _make_application(db, tenant_a, popup, status="accepted")
    other_vote = _make_application(db, tenant_a, popup)
    other_only = _make_application(db, tenant_a, popup)
    ordinary = _make_application(db, tenant_a, popup)
    unreviewed = _make_application(db, tenant_a, popup)
    another_popup = _make_application(db, tenant_a, _make_popup(db, tenant_a))
    different_vote = (
        ReviewDecision.NO if decision != ReviewDecision.NO else ReviewDecision.YES
    )
    for application, reviewer, vote in [
        (sophie_vote, sophie, decision),
        (sophie_vote, other, decision),
        (other_vote, sophie, different_vote),
        (other_vote, other, decision),
        (other_only, other, decision),
        (ordinary, sophie, different_vote),
        (another_popup, sophie, decision),
    ]:
        application_reviews_crud.create_review(
            db,
            application_id=application.id,
            reviewer_id=reviewer.id,
            tenant_id=tenant_a.id,
            review_in=ApplicationReviewCreate(decision=vote),
        )

    filters = {
        "match": "all",
        "conditions": [
            {"field": "reviewed_by", "op": "eq", "value": str(sophie.id)},
            {"field": "review_decision", "op": "eq", "value": decision},
        ],
    }
    response = _list(client, admin, tenant_a, popup, filters)
    assert _ids(response) == {str(sophie_vote.id)}
    assert response.json()["paging"]["total"] == 1

    # Condition order does not change reviewer/vote correlation.
    reversed_filters = {**filters, "conditions": list(reversed(filters["conditions"]))}
    assert _ids(_list(client, admin, tenant_a, popup, reversed_filters)) == {
        str(sophie_vote.id)
    }

    excluded_vote = {
        **filters,
        "conditions": [
            filters["conditions"][0],
            {"field": "review_decision", "op": "neq", "value": decision},
        ],
    }
    assert _ids(_list(client, admin, tenant_a, popup, excluded_vote)) == {
        str(other_vote.id),
        str(ordinary.id),
    }

    my_vote = {
        **filters,
        "conditions": [
            {"field": "reviewed_by_me", "op": "eq", "value": True},
            filters["conditions"][1],
        ],
    }
    assert _ids(_list(client, sophie, tenant_a, popup, my_vote)) == {
        str(sophie_vote.id)
    }

    # Any reviewer means at least one matching vote, not one result per vote.
    any_filters = _one("review_decision", "eq", decision)
    response = _list(client, admin, tenant_a, popup, any_filters)
    assert _ids(response) == {
        str(sophie_vote.id),
        str(other_vote.id),
        str(other_only.id),
    }
    assert len(response.json()["results"]) == response.json()["paging"]["total"] == 3
    pages = [
        _list(client, admin, tenant_a, popup, any_filters, skip=skip, limit=1)
        for skip in (0, 1, 2)
    ]
    assert set().union(*(_ids(page) for page in pages)) == _ids(response)
    assert all(page.json()["paging"]["total"] == 3 for page in pages)

    response = _list(
        client, admin, tenant_a, popup, _one("review_decision", "neq", decision)
    )
    assert _ids(response) == {str(ordinary.id), str(unreviewed.id)}

    # Filtered group counts and expanded buckets agree with the flat list.
    assert _buckets(
        _group_counts(client, admin, tenant_a, popup, "status", filters)
    ) == {"accepted": 1}
    assert _buckets(
        _group_counts(client, admin, tenant_a, popup, "status", any_filters)
    ) == {"accepted": 1, "in review": 2}
    assert _buckets(
        _group_counts(client, admin, tenant_a, popup, "reviewed_by", any_filters)
    ) == {str(sophie.id): 2, str(other.id): 3}
    assert _ids(
        _list(
            client,
            admin,
            tenant_a,
            popup,
            any_filters,
            group_by="status",
            group_value="in review",
        )
    ) == {str(other_vote.id), str(other_only.id)}

    # Additional application filters still use AND; match=any is a true OR
    # between independently matching reviewer, vote, and status conditions.
    combined = {
        "match": "all",
        "conditions": [
            *filters["conditions"],
            {"field": "status", "op": "eq", "value": "in review"},
        ],
    }
    assert _ids(_list(client, admin, tenant_a, popup, combined)) == set()
    combined["match"] = "any"
    assert _ids(_list(client, admin, tenant_a, popup, combined)) == {
        str(sophie_vote.id),
        str(other_vote.id),
        str(other_only.id),
        str(ordinary.id),
        str(unreviewed.id),
    }
    assert _ids(_list(client, admin, tenant_a, popup, {**filters, "match": "any"})) == {
        str(sophie_vote.id),
        str(other_vote.id),
        str(other_only.id),
        str(ordinary.id),
    }


@pytest.mark.parametrize(
    ("op", "value"),
    [("eq", "not-a-vote"), ("eq", True), ("eq", None), ("contains", "strong_yes")],
)
def test_invalid_review_vote_filters_return_422(
    db: Session, tenant_a: Tenants, client: TestClient, op: str, value
) -> None:
    response = _list(
        client,
        _make_admin(db, tenant_a),
        tenant_a,
        _make_popup(db, tenant_a),
        _one("review_decision", op, value),
    )
    assert response.status_code == 422, response.text
