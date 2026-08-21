"""Administrative application status overrides."""

import uuid
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications, ApplicationSnapshots
from app.api.application.schemas import ApplicationStatus, ScholarshipStatus
from app.api.audit_log.constants import AuditAction
from app.api.audit_log.models import AuditLog
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.shared.enums import HumanRating
from app.api.tenant.models import Tenants
from app.api.user.models import Users


def _auth(token: str, tenant_id: uuid.UUID) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-Tenant-Id": str(tenant_id),
    }


def _application(
    db: Session,
    tenant: Tenants,
    *,
    app_status: ApplicationStatus,
    red_flag: bool = False,
    scholarship_pending: bool = False,
) -> Applications:
    suffix = uuid.uuid4().hex[:10]
    popup = Popups(
        name=f"Status override {suffix}",
        slug=f"status-override-{suffix}",
        tenant_id=tenant.id,
        allows_scholarship=scholarship_pending,
    )
    db.add(popup)
    db.flush()
    human = Humans(
        tenant_id=tenant.id,
        email=f"status-override-{suffix}@test.com",
        first_name="Status",
        last_name="Override",
        rating=HumanRating.RED_FLAG if red_flag else HumanRating.UNRATED,
    )
    db.add(human)
    db.flush()
    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=app_status.value,
        accepted_at=datetime.now(UTC)
        if app_status == ApplicationStatus.ACCEPTED
        else None,
        scholarship_request=scholarship_pending,
        scholarship_status=ScholarshipStatus.PENDING.value
        if scholarship_pending
        else None,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def test_admin_can_override_rejected_to_accepted(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_user_tenant_a: Users,
    admin_token_tenant_a: str,
) -> None:
    application = _application(db, tenant_a, app_status=ApplicationStatus.REJECTED)
    response = client.patch(
        f"/api/v1/applications/{application.id}/status-override",
        headers=_auth(admin_token_tenant_a, tenant_a.id),
        json={
            "status": "accepted",
            "reason": "The review outcome was entered incorrectly.",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == ApplicationStatus.ACCEPTED.value
    assert body["accepted_at"] is not None
    assert body["status_override_reason"] == (
        "The review outcome was entered incorrectly."
    )
    assert body["status_overridden_by_user_id"] == str(admin_user_tenant_a.id)

    db.expire_all()
    snapshot = db.exec(
        select(ApplicationSnapshots).where(
            ApplicationSnapshots.application_id == application.id,
            ApplicationSnapshots.event == "admin_accepted",
        )
    ).first()
    assert snapshot is not None
    audit = db.exec(
        select(AuditLog).where(
            AuditLog.entity_id == application.id,
            AuditLog.action == AuditAction.APPLICATION_STATUS_OVERRIDDEN,
        )
    ).first()
    assert audit is not None
    assert audit.details is not None
    assert audit.details["old_status"] == "rejected"
    assert audit.details["new_status"] == "accepted"


def test_admin_rejection_clears_accepted_at(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    application = _application(db, tenant_a, app_status=ApplicationStatus.ACCEPTED)
    response = client.patch(
        f"/api/v1/applications/{application.id}/status-override",
        headers=_auth(admin_token_tenant_a, tenant_a.id),
        json={"status": "rejected", "reason": "Manual safety decision."},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == ApplicationStatus.REJECTED.value
    assert response.json()["accepted_at"] is None


def test_operator_cannot_override_application_status(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    operator_token_tenant_a: str,
) -> None:
    application = _application(db, tenant_a, app_status=ApplicationStatus.REJECTED)
    response = client.patch(
        f"/api/v1/applications/{application.id}/status-override",
        headers=_auth(operator_token_tenant_a, tenant_a.id),
        json={"status": "accepted", "reason": "Operator must not do this."},
    )
    assert response.status_code == 403


def test_cannot_accept_red_flagged_human(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    application = _application(
        db,
        tenant_a,
        app_status=ApplicationStatus.REJECTED,
        red_flag=True,
    )
    response = client.patch(
        f"/api/v1/applications/{application.id}/status-override",
        headers=_auth(admin_token_tenant_a, tenant_a.id),
        json={"status": "accepted", "reason": "Attempted exception."},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "red_flagged_human"


def test_cannot_accept_with_pending_scholarship(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    application = _application(
        db,
        tenant_a,
        app_status=ApplicationStatus.IN_REVIEW,
        scholarship_pending=True,
    )
    response = client.patch(
        f"/api/v1/applications/{application.id}/status-override",
        headers=_auth(admin_token_tenant_a, tenant_a.id),
        json={"status": "accepted", "reason": "Resolve this manually."},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "scholarship_pending"
