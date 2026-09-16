"""Regression tests: a deleted organization must not stay available.

Two surfaces are covered:
- GET /tenants never returns deleted organizations, so they never show up as a
  selectable context or in the admin listing.
- Tenant-scoped requests carrying a deleted X-Tenant-Id fail with an explicit
  "no longer available" 404 instead of the misleading credentials error raised
  once soft-delete revoked the tenant's database credentials.
"""

import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token


@pytest.fixture
def deleted_tenant(db: Session) -> Generator[Tenants, None, None]:
    suffix = uuid.uuid4().hex[:6]
    tenant = Tenants(
        name=f"Deleted Org {suffix}",
        slug=f"deleted-org-{suffix}",
        deleted=True,
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    yield tenant

    db.delete(tenant)
    db.commit()


def test_list_tenants_never_returns_deleted(
    client: TestClient,
    superadmin_token: str,
    deleted_tenant: Tenants,
) -> None:
    response = client.get(
        "/api/v1/tenants",
        headers={"Authorization": f"Bearer {superadmin_token}"},
        params={"limit": 100},
    )

    assert response.status_code == 200
    ids = [t["id"] for t in response.json()["results"]]
    assert str(deleted_tenant.id) not in ids


def test_get_deleted_tenant_returns_404(
    client: TestClient,
    superadmin_token: str,
    deleted_tenant: Tenants,
) -> None:
    response = client.get(
        f"/api/v1/tenants/{deleted_tenant.id}",
        headers={"Authorization": f"Bearer {superadmin_token}"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "This organization is no longer available"


def test_patch_deleted_tenant_returns_404(
    client: TestClient,
    superadmin_token: str,
    deleted_tenant: Tenants,
) -> None:
    response = client.patch(
        f"/api/v1/tenants/{deleted_tenant.id}",
        headers={"Authorization": f"Bearer {superadmin_token}"},
        json={"name": "Should Not Update"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "This organization is no longer available"


def test_delete_already_deleted_tenant_returns_404(
    client: TestClient,
    superadmin_token: str,
    deleted_tenant: Tenants,
) -> None:
    response = client.delete(
        f"/api/v1/tenants/{deleted_tenant.id}",
        headers={"Authorization": f"Bearer {superadmin_token}"},
    )

    assert response.status_code == 404


def test_tenant_scoped_request_rejects_deleted_tenant(
    client: TestClient,
    superadmin_token: str,
    deleted_tenant: Tenants,
) -> None:
    response = client.get(
        "/api/v1/popups",
        headers={
            "Authorization": f"Bearer {superadmin_token}",
            "X-Tenant-Id": str(deleted_tenant.id),
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "This organization is no longer available"


def test_delete_tenant_soft_deletes_users_and_invalidates_sessions(
    client: TestClient,
    db: Session,
    superadmin_token: str,
) -> None:
    suffix = uuid.uuid4().hex[:6]
    tenant = Tenants(
        name=f"Tenant With Users {suffix}",
        slug=f"tenant-with-users-{suffix}",
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    user = Users(
        email=f"tenant-admin-{suffix}@test.com",
        role=UserRole.ADMIN,
        tenant_id=tenant.id,
        auth_code="123456",
        auth_attempts=2,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    user_token = create_access_token(subject=user.id, token_type="user")
    user_headers = {"Authorization": f"Bearer {user_token}"}

    # Prime the authentication cache so deletion must explicitly invalidate it.
    assert client.get("/api/v1/users/me", headers=user_headers).status_code == 200

    response = client.delete(
        f"/api/v1/tenants/{tenant.id}",
        headers={"Authorization": f"Bearer {superadmin_token}"},
    )

    assert response.status_code == 204

    db.expire_all()
    deleted_tenant = db.get(Tenants, tenant.id)
    deleted_user = db.get(Users, user.id)
    assert deleted_tenant is not None and deleted_tenant.deleted
    assert deleted_user is not None and deleted_user.deleted
    assert deleted_user.auth_code is None
    assert deleted_user.code_expiration is None
    assert deleted_user.auth_attempts == 0

    # A JWT issued before the organization was deleted must stop working now.
    assert client.get("/api/v1/users/me", headers=user_headers).status_code == 401

    db.delete(deleted_user)
    db.delete(deleted_tenant)
    db.commit()
