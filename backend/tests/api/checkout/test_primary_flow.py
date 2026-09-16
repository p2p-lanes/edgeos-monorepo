"""Public resolution of a popup's canonical primary checkout flow."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants


def _popup_with_primary(db: Session, tenant: Tenants) -> tuple[Popups, SalesFlows]:
    slug = f"primary-{uuid.uuid4().hex[:8]}"
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Primary flow {slug}",
        slug=slug,
        sale_type="direct",
        status="active",
    )
    db.add(popup)
    db.flush()
    flow = sales_flows_crud.provision_default_flow(
        db,
        popup_id=popup.id,
        tenant_id=tenant.id,
        sale_type="direct",
    )
    db.commit()
    return popup, flow


def test_resolves_primary_flow_by_default_flag_not_conventional_slug(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup, primary = _popup_with_primary(db, tenant_a)
    primary.slug = "main-store"
    db.add(primary)
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/primary",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"flow_slug": "main-store"}


def test_primary_resolution_is_tenant_scoped(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    tenant_b: Tenants,
) -> None:
    popup, _primary = _popup_with_primary(db, tenant_a)

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/primary",
        headers={"X-Tenant-Id": str(tenant_b.id)},
    )

    assert response.status_code == 404


def test_popup_without_primary_flow_returns_not_found(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    slug = f"no-primary-{uuid.uuid4().hex[:8]}"
    popup = Popups(
        tenant_id=tenant_a.id,
        name=f"No primary {slug}",
        slug=slug,
        sale_type="direct",
        status="active",
    )
    db.add(popup)
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/primary",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 404
