import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.group.models import Groups
from app.api.human.models import Humans
from app.api.invite.models import Invites
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from tests.api.application_review.test_pending_reviews import (
    _auth,
    _make_admin,
    _make_popup,
)


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"source-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Access",
        last_name="Source",
    )
    db.add(human)
    db.flush()
    return human


def _get_application(
    client: TestClient,
    tenant: Tenants,
    admin,
    application: Applications,
):
    return client.get(
        f"/api/v1/applications/{application.id}",
        headers=_auth(admin, tenant),
    )


def test_application_detail_lists_only_present_access_sources(
    db: Session,
    tenant_a: Tenants,
    client: TestClient,
) -> None:
    popup: Popups = _make_popup(db, tenant_a)
    admin = _make_admin(db, tenant_a)
    applicant = _make_human(db, tenant_a)
    referrer = _make_human(db, tenant_a)
    group = Groups(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="Source Group",
        slug=f"source-group-{uuid.uuid4().hex[:8]}",
    )
    invite = Invites(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        token="source-invite",
        created_by=admin.id,
    )
    referral = Invites(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        token="source-referral",
        referrer_human_id=referrer.id,
        auto_approve=True,
    )
    db.add(group)
    db.add(invite)
    db.add(referral)
    db.flush()
    application = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=applicant.id,
        status=ApplicationStatus.ACCEPTED.value,
        group_id=group.id,
        invite_id=invite.id,
        referral_id=referral.id,
    )
    db.add(application)
    db.commit()

    response = _get_application(client, tenant_a, admin, application)

    assert response.status_code == 200, response.text
    assert response.json()["access_sources"] == [
        {"kind": "group", "id": str(group.id), "label": "Source Group"},
        {"kind": "invite", "id": str(invite.id), "label": "source-invite"},
        {
            "kind": "referral",
            "id": str(referral.id),
            "label": "source-referral",
        },
    ]


def test_application_detail_omits_access_sources_when_none_were_used(
    db: Session,
    tenant_a: Tenants,
    client: TestClient,
) -> None:
    popup: Popups = _make_popup(db, tenant_a)
    admin = _make_admin(db, tenant_a)
    applicant = _make_human(db, tenant_a)
    application = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=applicant.id,
        status=ApplicationStatus.IN_REVIEW.value,
    )
    db.add(application)
    db.commit()

    response = _get_application(client, tenant_a, admin, application)

    assert response.status_code == 200, response.text
    assert response.json()["access_sources"] == []
