"""Predefined fields are added to one sales flow's form."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.base_field_config.crud import base_field_configs_crud
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from tests._flow_helpers import provision_default_flow


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _popup(db: Session, tenant: Tenants) -> tuple[Popups, SalesFlows]:
    suffix = uuid.uuid4().hex[:8]
    popup = Popups(
        name=f"Catalog Flow {suffix}",
        slug=f"catalog-flow-{suffix}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup, provision_default_flow(db, popup)


def _flow(db: Session, popup: Popups) -> SalesFlows:
    suffix = uuid.uuid4().hex[:8]
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=f"catalog-{suffix}",
        name=f"Catalog {suffix}",
        type="application",
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _section(db: Session, popup: Popups, flow: SalesFlows) -> FormSections:
    section = FormSections(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        label="Personal Information",
        order=0,
    )
    db.add(section)
    db.commit()
    db.refresh(section)
    return section


def test_catalog_creates_config_in_selected_flow_only(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    popup, default = _popup(db, tenant_a)
    secondary = _flow(db, popup)
    secondary.allows_scholarship = True
    db.add(secondary)
    db.commit()
    default_section = _section(db, popup, default)
    secondary_section = _section(db, popup, secondary)
    url = f"/api/v1/form-fields/catalog/{popup.id}"
    headers = _headers(admin_token_tenant_a)

    created = client.post(
        f"{url}/residence",
        params={"sales_flow_id": str(secondary.id)},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["sales_flow_id"] == str(secondary.id)
    assert created.json()["section_id"] == str(secondary_section.id)
    assert created.json()["section_id"] != str(default_section.id)

    selected_catalog = client.get(
        url, params={"sales_flow_id": str(secondary.id)}, headers=headers
    )
    default_catalog = client.get(url, headers=headers)
    assert selected_catalog.status_code == 200, selected_catalog.text
    assert default_catalog.status_code == 200, default_catalog.text
    assert "residence" not in {f["field_name"] for f in selected_catalog.json()}
    assert "residence" in {f["field_name"] for f in default_catalog.json()}
    assert "scholarship_request" in {f["field_name"] for f in selected_catalog.json()}
    assert "scholarship_request" not in {
        f["field_name"] for f in default_catalog.json()
    }

    duplicate = client.post(
        f"{url}/residence",
        params={"sales_flow_id": str(secondary.id)},
        headers=headers,
    )
    assert duplicate.status_code == 400, duplicate.text
    assert len(base_field_configs_crud.find_by_flow(db, secondary.id)) == 1
    assert base_field_configs_crud.find_by_flow(db, default.id) == []


def test_catalog_without_flow_uses_popup_default(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    popup, default = _popup(db, tenant_a)
    secondary = _flow(db, popup)
    response = client.post(
        f"/api/v1/form-fields/catalog/{popup.id}/residence",
        headers=_headers(admin_token_tenant_a),
    )
    assert response.status_code == 201, response.text
    assert response.json()["sales_flow_id"] == str(default.id)
    assert len(base_field_configs_crud.find_by_flow(db, default.id)) == 1
    assert base_field_configs_crud.find_by_flow(db, secondary.id) == []


def test_catalog_rejects_flow_from_different_popup(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    popup, default = _popup(db, tenant_a)
    other_popup, _ = _popup(db, tenant_a)
    url = f"/api/v1/form-fields/catalog/{popup.id}"
    params = {"sales_flow_id": str(_flow(db, other_popup).id)}
    headers = _headers(admin_token_tenant_a)

    listed = client.get(url, params=params, headers=headers)
    created = client.post(f"{url}/residence", params=params, headers=headers)

    assert listed.status_code == 404, listed.text
    assert created.status_code == 404, created.text
    assert base_field_configs_crud.find_by_flow(db, default.id) == []
