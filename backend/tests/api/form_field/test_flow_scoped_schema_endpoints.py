"""Task 9.8 — form_field/router.py schema endpoints accept an explicit flow.

Design: sdd/sales-flows D6 URL scheme + slice 6 follow-up. Both
GET /form-fields/schema/{popup_id} (BO) and
GET /form-fields/portal/schema/{popup_id} (portal) previously always
resolved the popup's DEFAULT flow. They now accept an optional
`sales_flow_id` query param that, when given, must belong to the popup
(mirrors ticketing_step/router.py::_get_flow_or_404 — cross-popup flow
injection is rejected) and is used instead of the default.

TDD: RED -> GREEN.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from tests._flow_helpers import default_flow_id


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    slug = f"schema-flow-{uuid.uuid4().hex[:8]}"
    popup = Popups(tenant_id=tenant.id, name=f"Popup {slug}", slug=slug)
    db.add(popup)
    db.flush()
    sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type="application"
    )
    db.flush()
    return popup


def _make_flow(db: Session, popup: Popups, *, slug: str) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=slug,
        name=f"Flow {slug}",
        type="application",
    )
    db.add(flow)
    db.flush()
    return flow


def _make_field(db: Session, popup: Popups, *, name: str, sales_flow_id):
    section = FormSections(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        label="Section",
    )
    db.add(section)
    db.flush()
    field = FormFields(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        section_id=section.id,
        name=name,
        label=name,
        field_type="text",
    )
    db.add(field)
    db.flush()
    return field


class TestAdminSchemaEndpointAcceptsExplicitFlow:
    def test_explicit_sales_flow_id_resolves_that_flows_schema(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="vip")
        _make_field(
            db,
            popup,
            name="default_flow_field",
            sales_flow_id=default_flow_id(db, popup.id),
        )
        _make_field(db, popup, name="vip_field", sales_flow_id=flow.id)
        db.commit()

        response = client.get(
            f"/api/v1/form-fields/schema/{popup.id}",
            params={"sales_flow_id": str(flow.id)},
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code == 200, response.text
        assert "vip_field" in response.json()["custom_fields"]
        assert "default_flow_field" not in response.json()["custom_fields"]

    def test_omitted_sales_flow_id_resolves_default_flow(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="vip")
        _make_field(
            db,
            popup,
            name="default_flow_field",
            sales_flow_id=default_flow_id(db, popup.id),
        )
        _make_field(db, popup, name="vip_field", sales_flow_id=flow.id)
        db.commit()

        response = client.get(
            f"/api/v1/form-fields/schema/{popup.id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code == 200, response.text
        assert "default_flow_field" in response.json()["custom_fields"]
        assert "vip_field" not in response.json()["custom_fields"]

    def test_flow_from_another_popup_returns_404(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_a = _make_popup(db, tenant_a)
        popup_b = _make_popup(db, tenant_a)
        other_flow = _make_flow(db, popup_b, slug="only-on-b")
        db.commit()

        response = client.get(
            f"/api/v1/form-fields/schema/{popup_a.id}",
            params={"sales_flow_id": str(other_flow.id)},
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code == 404, response.text


class TestPortalSchemaEndpointAcceptsExplicitFlow:
    def test_explicit_sales_flow_id_resolves_that_flows_schema(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        from app.api.human.models import Humans
        from app.core.security import create_access_token

        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="vip")
        _make_field(
            db,
            popup,
            name="default_flow_field",
            sales_flow_id=default_flow_id(db, popup.id),
        )
        _make_field(db, popup, name="vip_field", sales_flow_id=flow.id)
        human = Humans(
            tenant_id=tenant_a.id,
            email=f"schema-flow-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Pat",
            last_name="Doe",
        )
        db.add(human)
        db.commit()
        token = create_access_token(subject=human.id, token_type="human")

        response = client.get(
            f"/api/v1/form-fields/portal/schema/{popup.id}",
            params={"sales_flow_id": str(flow.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        assert "vip_field" in response.json()["custom_fields"]
        assert "default_flow_field" not in response.json()["custom_fields"]
