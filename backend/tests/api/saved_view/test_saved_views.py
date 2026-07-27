"""Team-shared saved views for backoffice lists.

Covers popup+entity scoping, the entity whitelist, name and config
validation, duplicate-name conflicts, and the author-or-admin rule for
updates and deletes.

Each test creates a fresh popup so it is isolated from the session-scoped
shared fixtures (db / tenant_a have no per-test rollback).
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

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
        name="Saved Views Popup",
        slug=f"saved-views-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_user(db: Session, tenant: Tenants, role: UserRole) -> Users:
    user = Users(
        email=f"saved-views-{role.value.lower()}-{uuid.uuid4().hex[:8]}@test.com",
        role=role,
        tenant_id=tenant.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _create(
    client: TestClient,
    user: Users,
    tenant: Tenants,
    popup: Popups,
    name: str = "My view",
    entity: str = "applications",
    config: dict | None = None,
):
    return client.post(
        "/api/v1/saved-views",
        json={
            "popup_id": str(popup.id),
            "entity": entity,
            "name": name,
            "config": config if config is not None else {"filters": []},
        },
        headers=_auth(user, tenant),
    )


def _list(
    client: TestClient,
    user: Users,
    tenant: Tenants,
    popup: Popups,
    entity: str = "applications",
):
    return client.get(
        "/api/v1/saved-views",
        params={"popup_id": str(popup.id), "entity": entity},
        headers=_auth(user, tenant),
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSavedViewsCreateAndList:
    def test_create_and_list_scoped_by_popup(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup_one = _make_popup(db, tenant_a)
        popup_two = _make_popup(db, tenant_a)
        admin = _make_user(db, tenant_a, UserRole.ADMIN)

        response = _create(
            client,
            admin,
            tenant_a,
            popup_one,
            name="  Accepted only  ",
            config={"filters": [{"field": "status", "value": "accepted"}]},
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["name"] == "Accepted only"
        assert body["entity"] == "applications"
        assert body["created_by"] == str(admin.id)
        assert body["config"] == {"filters": [{"field": "status", "value": "accepted"}]}

        listed = _list(client, admin, tenant_a, popup_one)
        assert listed.status_code == 200, listed.text
        names = [v["name"] for v in listed.json()["results"]]
        assert names == ["Accepted only"]

        other = _list(client, admin, tenant_a, popup_two)
        assert other.status_code == 200, other.text
        assert other.json()["results"] == []

    def test_list_is_ordered_by_name(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_user(db, tenant_a, UserRole.ADMIN)

        assert _create(client, admin, tenant_a, popup, name="Zeta").status_code == 201
        assert _create(client, admin, tenant_a, popup, name="Alpha").status_code == 201

        listed = _list(client, admin, tenant_a, popup)
        names = [v["name"] for v in listed.json()["results"]]
        assert names == ["Alpha", "Zeta"]

    def test_duplicate_name_conflicts(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_user(db, tenant_a, UserRole.ADMIN)

        assert _create(client, admin, tenant_a, popup, name="Mine").status_code == 201
        response = _create(client, admin, tenant_a, popup, name="Mine")
        assert response.status_code == 409, response.text
        assert response.json()["detail"] == "A view with that name already exists."


class TestSavedViewsValidation:
    def test_invalid_entity_rejected_on_create_and_list(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_user(db, tenant_a, UserRole.ADMIN)

        response = _create(client, admin, tenant_a, popup, entity="attendees")
        assert response.status_code == 422, response.text
        assert (
            response.json()["detail"] == "Saved views are not available for this list."
        )

        listed = _list(client, admin, tenant_a, popup, entity="attendees")
        assert listed.status_code == 422, listed.text
        assert listed.json()["detail"] == "Saved views are not available for this list."

    def test_oversized_config_rejected(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_user(db, tenant_a, UserRole.ADMIN)

        response = _create(client, admin, tenant_a, popup, config={"blob": "x" * 10001})
        assert response.status_code == 422, response.text
        assert response.json()["detail"] == "This view is too large to save."

    def test_blank_name_rejected(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_user(db, tenant_a, UserRole.ADMIN)

        response = _create(client, admin, tenant_a, popup, name="   ")
        assert response.status_code == 422, response.text

        response = _create(client, admin, tenant_a, popup, name="x" * 101)
        assert response.status_code == 422, response.text


class TestSavedViewsPermissions:
    def test_viewer_cannot_create_but_can_list(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        viewer = _make_user(db, tenant_a, UserRole.VIEWER)

        response = _create(client, viewer, tenant_a, popup)
        assert response.status_code == 403, response.text

        listed = _list(client, viewer, tenant_a, popup)
        assert listed.status_code == 200, listed.text

    def test_non_author_operator_cannot_delete_but_author_can(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        author = _make_user(db, tenant_a, UserRole.OPERATOR)
        other = _make_user(db, tenant_a, UserRole.OPERATOR)

        created = _create(client, author, tenant_a, popup, name="Author's view")
        assert created.status_code == 201, created.text
        view_id = created.json()["id"]

        response = client.delete(
            f"/api/v1/saved-views/{view_id}", headers=_auth(other, tenant_a)
        )
        assert response.status_code == 403, response.text

        response = client.delete(
            f"/api/v1/saved-views/{view_id}", headers=_auth(author, tenant_a)
        )
        assert response.status_code == 204, response.text

    def test_admin_can_delete_another_users_view(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        author = _make_user(db, tenant_a, UserRole.OPERATOR)
        admin = _make_user(db, tenant_a, UserRole.ADMIN)

        created = _create(client, author, tenant_a, popup, name="Operator view")
        assert created.status_code == 201, created.text
        view_id = created.json()["id"]

        response = client.delete(
            f"/api/v1/saved-views/{view_id}", headers=_auth(admin, tenant_a)
        )
        assert response.status_code == 204, response.text

    def test_non_author_operator_cannot_patch(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        author = _make_user(db, tenant_a, UserRole.OPERATOR)
        other = _make_user(db, tenant_a, UserRole.OPERATOR)

        created = _create(client, author, tenant_a, popup, name="Locked view")
        assert created.status_code == 201, created.text
        view_id = created.json()["id"]

        response = client.patch(
            f"/api/v1/saved-views/{view_id}",
            json={"name": "Hijacked"},
            headers=_auth(other, tenant_a),
        )
        assert response.status_code == 403, response.text


class TestSavedViewsUpdate:
    def test_patch_rename_works_and_duplicate_conflicts(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_user(db, tenant_a, UserRole.ADMIN)

        first = _create(client, admin, tenant_a, popup, name="First")
        assert first.status_code == 201, first.text
        assert _create(client, admin, tenant_a, popup, name="Second").status_code == 201
        view_id = first.json()["id"]

        response = client.patch(
            f"/api/v1/saved-views/{view_id}",
            json={"name": "Renamed", "config": {"filters": [{"field": "email"}]}},
            headers=_auth(admin, tenant_a),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["name"] == "Renamed"
        assert body["config"] == {"filters": [{"field": "email"}]}

        response = client.patch(
            f"/api/v1/saved-views/{view_id}",
            json={"name": "Second"},
            headers=_auth(admin, tenant_a),
        )
        assert response.status_code == 409, response.text

    def test_patch_keeping_own_name_is_not_a_conflict(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_user(db, tenant_a, UserRole.ADMIN)

        created = _create(client, admin, tenant_a, popup, name="Stable")
        assert created.status_code == 201, created.text
        view_id = created.json()["id"]

        response = client.patch(
            f"/api/v1/saved-views/{view_id}",
            json={"name": "Stable", "config": {"columns": ["email"]}},
            headers=_auth(admin, tenant_a),
        )
        assert response.status_code == 200, response.text
        assert response.json()["config"] == {"columns": ["email"]}
