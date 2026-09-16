"""Portal authorization coverage for self-managed and managed Attendees."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import Attendees
from app.api.tenant.models import Tenants
from tests.api.attendee.test_http_my_attendees_by_popup import (
    _auth,
    _make_application,
    _make_human,
    _make_popup,
)


def _make_attendee(
    db: Session,
    tenant: Tenants,
    popup_id: uuid.UUID,
    *,
    name: str,
    human_id: uuid.UUID | None = None,
    manager_id: uuid.UUID | None = None,
    application_id: uuid.UUID | None = None,
    email: str | None = None,
) -> Attendees:
    attendee = Attendees(
        tenant_id=tenant.id,
        popup_id=popup_id,
        application_id=application_id,
        human_id=human_id,
        managed_by_human_id=manager_id,
        name=name,
        email=email,
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def test_list_combines_self_manager_and_legacy_ownership_without_inference(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, suffix="managed-list")
    current = _make_human(db, tenant_a, suffix="managed-list-current")
    other = _make_human(db, tenant_a, suffix="managed-list-other")
    application = _make_application(db, tenant_a, popup, current)

    self_attendee = _make_attendee(
        db, tenant_a, popup.id, name="Self", human_id=current.id
    )
    managed = _make_attendee(
        db, tenant_a, popup.id, name="Managed", manager_id=current.id
    )
    legacy = _make_attendee(
        db,
        tenant_a,
        popup.id,
        name="Legacy",
        application_id=application.id,
    )
    explicitly_reassigned = _make_attendee(
        db,
        tenant_a,
        popup.id,
        name="Explicitly reassigned",
        manager_id=other.id,
        application_id=application.id,
    )
    profile_match = _make_attendee(
        db,
        tenant_a,
        popup.id,
        name="Profile match only",
        email=current.email,
    )

    response = client.get(
        f"/api/v1/attendees/my/popup/{popup.id}", headers=_auth(current)
    )

    assert response.status_code == 200
    results = response.json()["results"]
    assert {item["id"] for item in results} == {
        str(self_attendee.id),
        str(managed.id),
        str(legacy.id),
    }
    purchases = attendees_crud.find_purchases_by_human_popup(
        db,
        human_id=current.id,
        popup_id=popup.id,
        tenant_id=tenant_a.id,
    )
    assert {attendee.id for attendee in purchases} == {
        self_attendee.id,
        managed.id,
        legacy.id,
    }
    assert explicitly_reassigned.id not in {attendee.id for attendee in purchases}
    assert profile_match.id not in {attendee.id for attendee in purchases}


def test_explicit_manager_can_list_update_and_delete(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, suffix="managed-actions")
    manager = _make_human(db, tenant_a, suffix="managed-actions-manager")
    attendee = _make_attendee(
        db, tenant_a, popup.id, name="Managed", manager_id=manager.id
    )
    url = f"/api/v1/attendees/my/popup/{popup.id}/{attendee.id}"
    list_response = client.get(
        f"/api/v1/attendees/my/popup/{popup.id}", headers=_auth(manager)
    )
    update_response = client.patch(
        url, headers=_auth(manager), json={"name": "Managed Updated"}
    )
    delete_response = client.delete(url, headers=_auth(manager))
    assert list_response.status_code == 200
    assert {item["id"] for item in list_response.json()["results"]} == {
        str(attendee.id)
    }
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Managed Updated"
    assert delete_response.status_code == 200
    assert delete_response.json() == {"ok": True}


@pytest.mark.parametrize("method", ["patch", "delete"])
def test_explicit_wrong_manager_is_non_enumerating(
    method: str, client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, suffix=f"wrong-manager-{method}")
    legacy_owner = _make_human(db, tenant_a, suffix=f"legacy-owner-{method}")
    actual_manager = _make_human(db, tenant_a, suffix=f"actual-manager-{method}")
    application = _make_application(db, tenant_a, popup, legacy_owner)
    attendee = _make_attendee(
        db,
        tenant_a,
        popup.id,
        name="Not Yours",
        manager_id=actual_manager.id,
        application_id=application.id,
    )
    url = f"/api/v1/attendees/my/popup/{popup.id}/{attendee.id}"

    response = getattr(client, method)(
        url,
        headers=_auth(legacy_owner),
        **({"json": {"name": "Stolen"}} if method == "patch" else {}),
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Attendee not found"}


def test_update_rejects_wrong_popup_and_tenant(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    tenant_b: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, suffix="scope-source")
    other_popup = _make_popup(db, tenant_a, suffix="scope-other")
    manager = _make_human(db, tenant_a, suffix="scope-manager")
    other_tenant_human = _make_human(db, tenant_b, suffix="scope-other-tenant")
    attendee = _make_attendee(
        db, tenant_a, popup.id, name="Scoped", manager_id=manager.id
    )

    wrong_popup = client.patch(
        f"/api/v1/attendees/my/popup/{other_popup.id}/{attendee.id}",
        headers=_auth(manager),
        json={"name": "Wrong popup"},
    )
    wrong_tenant = client.patch(
        f"/api/v1/attendees/my/popup/{popup.id}/{attendee.id}",
        headers=_auth(other_tenant_human),
        json={"name": "Wrong tenant"},
    )

    assert wrong_popup.status_code == 404
    assert wrong_popup.json() == {"detail": "Attendee not found"}
    assert wrong_tenant.status_code == 404
    assert wrong_tenant.json() == {"detail": "Attendee not found"}
