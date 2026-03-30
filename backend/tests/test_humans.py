import uuid

from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"human-{suffix}@test.com",
        first_name=f"Human {suffix}",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    status: ApplicationStatus,
) -> Applications:
    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=status.value,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Popup {suffix}",
        slug=f"popup-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def test_list_humans_can_filter_incomplete_applications_by_popup(
    client,
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    admin_token_tenant_a: str,
):
    suffix = uuid.uuid4().hex[:8]
    other_popup = _make_popup(db, tenant_a, suffix=f"other-{suffix}")
    draft_human = _make_human(db, tenant_a, suffix=f"draft-{suffix}")
    accepted_human = _make_human(db, tenant_a, suffix=f"accepted-{suffix}")
    other_popup_draft_human = _make_human(db, tenant_a, suffix=f"other-popup-{suffix}")

    _make_application(
        db,
        tenant_a,
        popup_tenant_a,
        draft_human,
        status=ApplicationStatus.DRAFT,
    )
    _make_application(
        db,
        tenant_a,
        popup_tenant_a,
        accepted_human,
        status=ApplicationStatus.ACCEPTED,
    )
    _make_application(
        db,
        tenant_a,
        other_popup,
        other_popup_draft_human,
        status=ApplicationStatus.DRAFT,
    )

    response = client.get(
        "/api/v1/humans",
        params={
            "incomplete_application": True,
            "popup_id": str(popup_tenant_a.id),
            "search": suffix,
        },
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
    )

    assert response.status_code == 200
    body = response.json()

    assert body["paging"]["total"] == 1
    assert [result["id"] for result in body["results"]] == [str(draft_human.id)]


def test_list_humans_requires_popup_for_incomplete_application_filter(
    client,
    admin_token_tenant_a: str,
):
    response = client.get(
        "/api/v1/humans",
        params={"incomplete_application": True},
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "popup_id is required when filtering incomplete applications"
    )
