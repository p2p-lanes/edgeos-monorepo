"""Slice 14, task 14.1 — HTTP endpoint for `FormFieldsCRUD.copy_form_to_flow`
(the CRUD half shipped in slice 6 with no router exposure — see that
method's docstring: "No endpoint exposes this yet — the backoffice UI lands
in a later slice (14)."). The backoffice confirm-dialog action calls this.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.base_field_config.crud import base_field_configs_crud
from app.api.base_field_config.models import BaseFieldConfigs
from app.api.form_field.crud import form_fields_crud
from app.api.form_field.models import FormFields
from app.api.form_section.crud import form_sections_crud
from app.api.form_section.models import FormSections
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_popup_via_api(client: TestClient, admin_token: str) -> str:
    unique = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/popups",
        headers=_headers(admin_token),
        json={"name": f"Copy Form To Flow Test {unique}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _make_flow(db: Session, tenant: Tenants, popup_id: str, *, slug: str) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=tenant.id,
        popup_id=uuid.UUID(popup_id),
        slug=slug,
        name=slug,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _seed_shared_field(db: Session, tenant: Tenants, popup_id: str, name: str) -> None:
    field = FormFields(
        tenant_id=tenant.id,
        popup_id=uuid.UUID(popup_id),
        sales_flow_id=None,
        name=name,
        label=name,
        field_type="text",
        position=0,
    )
    db.add(field)
    db.commit()


class TestCopyFormToFlowEndpoint:
    def test_copy_from_popup_shared_tier_to_target_flow(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        target = _make_flow(db, tenant_a, popup_id, slug="target-copy-a")
        _seed_shared_field(db, tenant_a, popup_id, "copyable_field")

        resp = client.post(
            f"/api/v1/form-fields/copy-to-flow/{target.id}",
            headers=_headers(admin_token_tenant_a),
            json={"source_flow_id": None},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["fields"] == 1

        schema = form_fields_crud.build_schema_for_flow(
            db, uuid.UUID(popup_id), target.id
        )
        assert "copyable_field" in schema["custom_fields"]

    def test_source_flow_from_a_different_popup_is_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        other_popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        target = _make_flow(db, tenant_a, popup_id, slug="target-copy-b")
        foreign_source = _make_flow(db, tenant_a, other_popup_id, slug="foreign-source")

        resp = client.post(
            f"/api/v1/form-fields/copy-to-flow/{target.id}",
            headers=_headers(admin_token_tenant_a),
            json={"source_flow_id": str(foreign_source.id)},
        )
        assert resp.status_code == 404

    def test_unknown_target_flow_is_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.post(
            f"/api/v1/form-fields/copy-to-flow/{uuid.uuid4()}",
            headers=_headers(admin_token_tenant_a),
            json={"source_flow_id": None},
        )
        assert resp.status_code == 404

    def test_copy_replaces_target_form_no_duplicates_on_recopy(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Copying twice must never duplicate rows, and section_id
        remapping must land on the copied section, not the source's."""
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        popup_uuid = uuid.UUID(popup_id)
        source = _make_flow(db, tenant_a, popup_id, slug="source-copy-c")
        target = _make_flow(db, tenant_a, popup_id, slug="target-copy-c")

        # id is client-side (default_factory), so section.id is usable
        # below without a round trip.
        section = FormSections(
            tenant_id=tenant_a.id,
            popup_id=popup_uuid,
            sales_flow_id=source.id,
            label="Contact",
            order=0,
        )
        db.add(section)
        db.add(
            BaseFieldConfigs(
                tenant_id=tenant_a.id,
                popup_id=popup_uuid,
                sales_flow_id=source.id,
                field_name="phone",
                section_id=section.id,
                label="Phone",
            )
        )
        db.add(
            FormFields(
                tenant_id=tenant_a.id,
                popup_id=popup_uuid,
                sales_flow_id=source.id,
                name="favorite_color",
                label="Favorite color",
                field_type="text",
                section_id=section.id,
                position=0,
            )
        )
        db.add(
            FormFields(  # stale target row a genuine replace must wipe
                tenant_id=tenant_a.id,
                popup_id=popup_uuid,
                sales_flow_id=target.id,
                name="stale_field",
                label="Stale field",
                field_type="text",
                position=0,
            )
        )
        db.commit()

        for _ in range(2):
            resp = client.post(
                f"/api/v1/form-fields/copy-to-flow/{target.id}",
                headers=_headers(admin_token_tenant_a),
                json={"source_flow_id": str(source.id)},
            )
            assert resp.status_code == 200, resp.text
            body = resp.json()
            assert body == {"sections": 1, "base_fields": 1, "fields": 1}

        target_fields, fields_total = form_fields_crud.find_by_flow(
            db, target.id, limit=1000
        )
        assert fields_total == 1
        assert target_fields[0].name == "favorite_color"

        target_configs = base_field_configs_crud.find_by_flow(db, target.id)
        assert len(target_configs) == 1
        assert target_configs[0].field_name == "phone"

        target_sections, sections_total = form_sections_crud.find_by_flow(
            db, target.id, limit=None
        )
        assert sections_total == 1
        assert target_sections[0].label == "Contact"

        # section_id remapping: the copy points at the copied section's own
        # (new) id, never the source's original section id.
        assert target_fields[0].section_id == target_sections[0].id
        assert target_configs[0].section_id == target_sections[0].id
        assert target_sections[0].id != section.id
