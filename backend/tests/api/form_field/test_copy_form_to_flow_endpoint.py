"""Slice 14, task 14.1 — HTTP endpoint for `FormFieldsCRUD.copy_form_to_flow`
(the CRUD half shipped in slice 6 with no router exposure — see that
method's docstring: "No endpoint exposes this yet — the backoffice UI lands
in a later slice (14)."). The backoffice confirm-dialog action calls this.
"""

import uuid
from io import StringIO

import pytest
from fastapi.testclient import TestClient
from loguru import logger
from sqlmodel import Session, select

from app.api.audit_log.models import AuditLog
from app.api.base_field_config.crud import base_field_configs_crud
from app.api.base_field_config.models import BaseFieldConfigs
from app.api.form_field.crud import form_fields_crud
from app.api.form_field.models import FormFields
from app.api.form_section.crud import form_sections_crud
from app.api.form_section.models import FormSections
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from tests._flow_helpers import default_flow_id


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


def _make_flow(
    db: Session,
    tenant: Tenants,
    popup_id: str,
    *,
    slug: str,
    flow_type: str = "application",
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=tenant.id,
        popup_id=uuid.UUID(popup_id),
        slug=slug,
        name=slug,
        type=flow_type,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _seed_default_flow_field(
    db: Session, tenant: Tenants, popup_id: str, name: str
) -> None:
    """Seed a field into the popup's default flow — what an omitted
    `source_flow_id` resolves to."""
    field = FormFields(
        tenant_id=tenant.id,
        popup_id=uuid.UUID(popup_id),
        sales_flow_id=default_flow_id(db, uuid.UUID(popup_id)),
        name=name,
        label=name,
        field_type="text",
        position=0,
    )
    db.add(field)
    db.commit()


class TestCopyFormToFlowEndpoint:
    @pytest.mark.parametrize("implicit_source", [False, True])
    def test_self_copy_is_rejected_without_mutation_or_audit(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
        implicit_source: bool,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        target_id = default_flow_id(db, uuid.UUID(popup_id))
        sections_before, total_before = form_sections_crud.find_by_flow(
            db, target_id, limit=None
        )
        assert any(section.protected for section in sections_before)
        section_state_before = [
            (section.id, section.protected) for section in sections_before
        ]

        resp = client.post(
            f"/api/v1/form-fields/copy-to-flow/{target_id}",
            headers=_headers(admin_token_tenant_a),
            json={"source_flow_id": None if implicit_source else str(target_id)},
        )

        assert resp.status_code == 422, resp.text
        assert (
            resp.json()["detail"] == "Source and target sales flows must be different"
        )
        sections, total = form_sections_crud.find_by_flow(db, target_id, limit=None)
        assert total == total_before
        assert [(section.id, section.protected) for section in sections] == (
            section_state_before
        )
        audit_rows = db.exec(
            select(AuditLog).where(
                AuditLog.action == "form.copied_to_flow",
                AuditLog.entity_id == target_id,
            )
        ).all()
        assert audit_rows == []

    def test_omitted_source_copies_the_default_flows_form(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        target = _make_flow(db, tenant_a, popup_id, slug="target-copy-a")
        _seed_default_flow_field(db, tenant_a, popup_id, "copyable_field")

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

    def test_source_with_a_different_type_is_rejected_without_mutation(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        source = _make_flow(
            db,
            tenant_a,
            popup_id,
            slug="source-application",
            flow_type="application",
        )
        target = _make_flow(
            db,
            tenant_a,
            popup_id,
            slug="target-direct",
            flow_type="direct",
        )
        db.add(
            FormFields(
                tenant_id=tenant_a.id,
                popup_id=uuid.UUID(popup_id),
                sales_flow_id=target.id,
                name="untouched",
                label="Untouched",
                field_type="text",
                position=0,
            )
        )
        db.commit()

        resp = client.post(
            f"/api/v1/form-fields/copy-to-flow/{target.id}",
            headers=_headers(admin_token_tenant_a),
            json={"source_flow_id": str(source.id)},
        )

        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"] == (
            "Source sales flow must have the same type as the target flow"
        )
        target_fields, total = form_fields_crud.find_by_flow(db, target.id, limit=1000)
        assert total == 1
        assert target_fields[0].name == "untouched"

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
        db.flush()
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

        log_stream = StringIO()
        sink_id = logger.add(log_stream, format="{message}", level="WARNING")
        try:
            for _ in range(2):
                resp = client.post(
                    f"/api/v1/form-fields/copy-to-flow/{target.id}",
                    headers=_headers(admin_token_tenant_a),
                    json={"source_flow_id": str(source.id)},
                )
                assert resp.status_code == 200, resp.text
                body = resp.json()
                assert body == {"sections": 1, "base_fields": 1, "fields": 1}
        finally:
            logger.remove(sink_id)

        log_line = log_stream.getvalue()
        assert "form_field.copy_to_flow replacing target form" in log_line
        assert str(source.id) in log_line
        assert str(target.id) in log_line
        assert "actor_user_id=" in log_line

        target_fields, fields_total = form_fields_crud.find_by_flow(
            db, target.id, limit=1000
        )
        assert fields_total == 1
        assert target_fields[0].name == "favorite_color"

        previous_section_id = target_fields[0].section_id
        unassigned = client.patch(
            f"/api/v1/form-fields/{target_fields[0].id}",
            headers=_headers(admin_token_tenant_a),
            json={"section_id": None},
        )
        assert unassigned.status_code == 200, unassigned.text
        assert unassigned.json()["section_id"] is None

        target_configs = base_field_configs_crud.find_by_flow(db, target.id)
        assert len(target_configs) == 1
        assert target_configs[0].field_name == "phone"

        audit_rows = db.exec(
            select(AuditLog).where(
                AuditLog.action == "form.copied_to_flow",
                AuditLog.entity_id == target.id,
            )
        ).all()
        assert len(audit_rows) == 2
        assert all(row.request_id for row in audit_rows)
        assert all(
            row.details["source_flow_id"] == str(source.id) for row in audit_rows
        )
        assert sorted(row.details["replaced"]["sections"] for row in audit_rows) == [
            0,
            1,
        ]
        assert sorted(row.details["replaced"]["base_fields"] for row in audit_rows) == [
            0,
            1,
        ]
        assert all(row.details["replaced"]["custom_fields"] == 1 for row in audit_rows)
        assert all(row.details["copied"]["sections"] == 1 for row in audit_rows)

        unassignment_log = db.exec(
            select(AuditLog).where(
                AuditLog.action == "form_field.section_changed",
                AuditLog.entity_id == target_fields[0].id,
            )
        ).one()
        assert unassignment_log.details is not None
        assert unassignment_log.details["previous_section_id"] == str(
            previous_section_id
        )
        assert unassignment_log.details["section_id"] is None

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

    def test_copy_replaces_protected_target_and_preserves_source_protection(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        popup_uuid = uuid.UUID(popup_id)
        source = _make_flow(db, tenant_a, popup_id, slug="source-protected")
        target = _make_flow(db, tenant_a, popup_id, slug="target-protected")

        source_section = FormSections(
            tenant_id=tenant_a.id,
            popup_id=popup_uuid,
            sales_flow_id=source.id,
            label="New Personal Information",
            order=0,
            protected=True,
        )
        target_section = FormSections(
            tenant_id=tenant_a.id,
            popup_id=popup_uuid,
            sales_flow_id=target.id,
            label="Old Personal Information",
            order=0,
            protected=True,
        )
        db.add_all([source_section, target_section])
        db.flush()
        db.add_all(
            [
                BaseFieldConfigs(
                    tenant_id=tenant_a.id,
                    popup_id=popup_uuid,
                    sales_flow_id=source.id,
                    field_name="phone",
                    section_id=source_section.id,
                    label="New Phone",
                ),
                BaseFieldConfigs(
                    tenant_id=tenant_a.id,
                    popup_id=popup_uuid,
                    sales_flow_id=target.id,
                    field_name="phone",
                    section_id=target_section.id,
                    label="Old Phone",
                ),
                FormFields(
                    tenant_id=tenant_a.id,
                    popup_id=popup_uuid,
                    sales_flow_id=source.id,
                    name="new_field",
                    label="New field",
                    field_type="text",
                    section_id=source_section.id,
                ),
                FormFields(
                    tenant_id=tenant_a.id,
                    popup_id=popup_uuid,
                    sales_flow_id=target.id,
                    name="old_field",
                    label="Old field",
                    field_type="text",
                    section_id=target_section.id,
                ),
            ]
        )
        db.commit()
        source_section_id = source_section.id
        target_section_id = target_section.id

        for _ in range(2):
            resp = client.post(
                f"/api/v1/form-fields/copy-to-flow/{target.id}",
                headers=_headers(admin_token_tenant_a),
                json={"source_flow_id": str(source.id)},
            )
            assert resp.status_code == 200, resp.text
            assert resp.json() == {"sections": 1, "base_fields": 1, "fields": 1}

            sections, section_count = form_sections_crud.find_by_flow(
                db, target.id, limit=None
            )
            fields, field_count = form_fields_crud.find_by_flow(
                db, target.id, limit=1000
            )
            configs = base_field_configs_crud.find_by_flow(db, target.id)
            assert section_count == field_count == len(configs) == 1
            assert sections[0].id not in {target_section_id, source_section_id}
            assert sections[0].label == "New Personal Information"
            assert sections[0].protected is True
            assert fields[0].name == "new_field"
            assert fields[0].section_id == sections[0].id
            assert configs[0].label == "New Phone"
            assert configs[0].section_id == sections[0].id
            assert db.get(FormSections, source_section_id).protected is True
