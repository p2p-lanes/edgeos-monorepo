"""Regression tests: a deleted organization must not stay available.

Two surfaces are covered:
- GET /tenants hides deleted organizations unless include_deleted is requested,
  so they never show up as a selectable context.
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


def test_list_tenants_hides_deleted_by_default(
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


def test_list_tenants_includes_deleted_when_requested(
    client: TestClient,
    superadmin_token: str,
    deleted_tenant: Tenants,
) -> None:
    response = client.get(
        "/api/v1/tenants",
        headers={"Authorization": f"Bearer {superadmin_token}"},
        params={"limit": 100, "include_deleted": True},
    )

    assert response.status_code == 200
    ids = [t["id"] for t in response.json()["results"]]
    assert str(deleted_tenant.id) in ids


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
