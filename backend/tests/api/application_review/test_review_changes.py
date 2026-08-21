"""Review vote changes while an application remains open."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.application_review.models import ApplicationReviews
from app.api.application_review.schemas import ReviewDecision
from app.api.approval_strategy.models import ApprovalStrategies
from app.api.approval_strategy.schemas import ApprovalStrategyType
from app.api.audit_log.constants import AuditAction
from app.api.audit_log.models import AuditLog
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.user.models import Users


def _auth(token: str, tenant_id: uuid.UUID) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-Tenant-Id": str(tenant_id),
    }


def _open_application(
    db: Session,
    tenant: Tenants,
    *,
    strategy_type: ApprovalStrategyType,
) -> Applications:
    suffix = uuid.uuid4().hex[:10]
    popup = Popups(
        name=f"Review change {suffix}",
        slug=f"review-change-{suffix}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.flush()
    db.add(
        ApprovalStrategies(
            popup_id=popup.id,
            tenant_id=tenant.id,
            strategy_type=strategy_type,
            required_approvals=2,
        )
    )
    human = Humans(
        tenant_id=tenant.id,
        email=f"review-change-{suffix}@test.com",
        first_name="Review",
        last_name="Change",
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


def test_reviewer_can_change_vote_while_application_is_in_review(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    operator_user_tenant_a: Users,
    operator_token_tenant_a: str,
) -> None:
    application = _open_application(
        db, tenant_a, strategy_type=ApprovalStrategyType.THRESHOLD
    )
    headers = _auth(operator_token_tenant_a, tenant_a.id)

    created = client.post(
        f"/api/v1/applications/{application.id}/reviews",
        headers=headers,
        json={"decision": "yes"},
    )
    assert created.status_code == 201, created.text
    original_updated_at = created.json()["updated_at"]

    changed = client.patch(
        f"/api/v1/applications/{application.id}/reviews/me",
        headers=headers,
        json={
            "decision": "strong_no",
            "expected_updated_at": original_updated_at,
        },
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["decision"] == ReviewDecision.STRONG_NO.value

    stale_change = client.patch(
        f"/api/v1/applications/{application.id}/reviews/me",
        headers=headers,
        json={
            "decision": "yes",
            "expected_updated_at": original_updated_at,
        },
    )
    assert stale_change.status_code == 409
    assert stale_change.json()["detail"]["code"] == "review_changed"

    db.expire_all()
    reviews = db.exec(
        select(ApplicationReviews).where(
            ApplicationReviews.application_id == application.id,
            ApplicationReviews.reviewer_id == operator_user_tenant_a.id,
        )
    ).all()
    assert len(reviews) == 1
    assert reviews[0].decision == ReviewDecision.STRONG_NO
    fresh_application = db.get(Applications, application.id)
    assert fresh_application is not None
    assert fresh_application.status == ApplicationStatus.IN_REVIEW.value

    audit = db.exec(
        select(AuditLog).where(
            AuditLog.entity_id == application.id,
            AuditLog.action == AuditAction.APPLICATION_REVIEW_CHANGED,
        )
    ).first()
    assert audit is not None
    assert audit.details is not None
    assert audit.details["old_decision"] == "yes"
    assert audit.details["new_decision"] == "strong_no"


def test_changed_vote_can_finalize_application(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    operator_token_tenant_a: str,
) -> None:
    application = _open_application(
        db, tenant_a, strategy_type=ApprovalStrategyType.ANY_REVIEWER
    )
    headers = _auth(operator_token_tenant_a, tenant_a.id)

    created = client.post(
        f"/api/v1/applications/{application.id}/reviews",
        headers=headers,
        json={"decision": "no"},
    )
    assert created.status_code == 201, created.text

    changed = client.patch(
        f"/api/v1/applications/{application.id}/reviews/me",
        headers=headers,
        json={
            "decision": "strong_yes",
            "expected_updated_at": created.json()["updated_at"],
        },
    )
    assert changed.status_code == 200, changed.text

    db.expire_all()
    fresh_application = db.get(Applications, application.id)
    assert fresh_application is not None
    assert fresh_application.status == ApplicationStatus.ACCEPTED.value
    assert fresh_application.accepted_at is not None


def test_finalized_application_rejects_vote_change(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    operator_user_tenant_a: Users,
    operator_token_tenant_a: str,
) -> None:
    application = _open_application(
        db, tenant_a, strategy_type=ApprovalStrategyType.ANY_REVIEWER
    )
    headers = _auth(operator_token_tenant_a, tenant_a.id)

    created = client.post(
        f"/api/v1/applications/{application.id}/reviews",
        headers=headers,
        json={"decision": "yes"},
    )
    assert created.status_code == 201, created.text

    changed = client.patch(
        f"/api/v1/applications/{application.id}/reviews/me",
        headers=headers,
        json={"decision": "strong_no"},
    )
    assert changed.status_code == 409
    assert changed.json()["detail"]["code"] == "application_no_longer_in_review"

    db.expire_all()
    review = db.exec(
        select(ApplicationReviews).where(
            ApplicationReviews.application_id == application.id,
            ApplicationReviews.reviewer_id == operator_user_tenant_a.id,
        )
    ).one()
    assert review.decision == ReviewDecision.YES


def test_post_does_not_silently_overwrite_existing_review(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    operator_token_tenant_a: str,
) -> None:
    application = _open_application(
        db, tenant_a, strategy_type=ApprovalStrategyType.THRESHOLD
    )
    headers = _auth(operator_token_tenant_a, tenant_a.id)

    first = client.post(
        f"/api/v1/applications/{application.id}/reviews",
        headers=headers,
        json={"decision": "yes"},
    )
    assert first.status_code == 201, first.text

    duplicate = client.post(
        f"/api/v1/applications/{application.id}/reviews",
        headers=headers,
        json={"decision": "no"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["code"] == "review_already_exists"
