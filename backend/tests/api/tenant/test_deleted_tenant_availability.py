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

from app.api.tenant.models import Tenants


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
