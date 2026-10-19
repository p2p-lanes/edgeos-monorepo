import uuid
from io import StringIO

import pytest
from fastapi.testclient import TestClient
from loguru import logger
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.api.audit_log.models import AuditLog
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.tenant.models import Tenants
from tests._flow_helpers import default_flow_id


def test_database_rejects_direct_delete_of_protected_section(
    db: Session,
    tenant_a: Tenants,
) -> None:
    slug = f"protected-db-section-{uuid.uuid4().hex[:8]}"
    popup = Popups(tenant_id=tenant_a.id, name=f"Popup {slug}", slug=slug)
    db.add(popup)
    db.flush()
    flow = sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant_a.id, sale_type="application"
    )
    section = FormSections(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        label="Protected section",
        protected=True,
    )
    db.add(section)
    db.commit()
    section_id = section.id

    with pytest.raises(IntegrityError, match="Cannot delete a protected form section"):
        db.exec(
            text("DELETE FROM formsections WHERE id = :section_id").bindparams(
                section_id=section_id
            )
        )
    db.rollback()

    assert db.get(FormSections, section_id) is not None

    db.exec(
        text("DELETE FROM popups WHERE id = :popup_id").bindparams(popup_id=popup.id)
    )
    db.commit()
    assert db.get(FormSections, section_id) is None


def test_protected_section_cannot_be_deleted_until_unprotected(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    slug = f"protected-section-{uuid.uuid4().hex[:8]}"
    popup = Popups(tenant_id=tenant_a.id, name=f"Popup {slug}", slug=slug)
    db.add(popup)
    db.flush()
    sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant_a.id, sale_type="application"
    )
    flow_id = default_flow_id(db, popup.id)
    db.commit()
    headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}

    created = client.post(
        "/api/v1/form-sections",
        headers=headers,
        json={
            "popup_id": str(popup.id),
            "sales_flow_id": str(flow_id),
            "label": "Personal Information",
            "protected": True,
        },
    )
    assert created.status_code == 201, created.text
    section_id = created.json()["id"]
    assert created.json()["protected"] is True
    section_uuid = uuid.UUID(section_id)
    created_audit = db.exec(
        select(AuditLog).where(
            AuditLog.action == "form_section.created",
            AuditLog.entity_id == section_uuid,
        )
    ).one()
    assert created_audit.actor_email == "admin-a@test.com"
    assert created_audit.request_id
    db.add(
        FormFields(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            sales_flow_id=flow_id,
            section_id=section_uuid,
            name="audit_test_field",
            label="Audit test field",
            field_type="text",
        )
    )
    db.commit()

    rejected_log_stream = StringIO()
    rejected_sink_id = logger.add(
        rejected_log_stream, format="{message}", level="WARNING"
    )
    try:
        deleted = client.delete(f"/api/v1/form-sections/{section_id}", headers=headers)
    finally:
        logger.remove(rejected_sink_id)
    assert deleted.status_code == 400
    assert deleted.json()["detail"] == "Cannot delete a protected section"
    assert "form_section.delete_rejected" in rejected_log_stream.getvalue()

    updated = client.patch(
        f"/api/v1/form-sections/{section_id}",
        headers=headers,
        json={"protected": False},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["protected"] is False
    protection_audit = db.exec(
        select(AuditLog).where(
            AuditLog.action == "form_section.updated",
            AuditLog.entity_id == section_uuid,
        )
    ).one()
    assert protection_audit.details is not None
    assert protection_audit.details["changes"]["protected"] == {
        "from": True,
        "to": False,
    }

    log_stream = StringIO()
    sink_id = logger.add(log_stream, format="{message}", level="WARNING")
    try:
        deleted = client.delete(f"/api/v1/form-sections/{section_id}", headers=headers)
    finally:
        logger.remove(sink_id)
    assert deleted.status_code == 204
    log_line = log_stream.getvalue()
    assert "form_section.delete" in log_line
    assert str(popup.id) in log_line
    assert "actor_user_id=" in log_line

    rows = db.exec(select(AuditLog).where(AuditLog.entity_id == section_uuid)).all()
    by_action = {row.action: row for row in rows}
    assert "form_section.created" in by_action
    assert "form_section.delete_rejected" in by_action
    assert "form_section.updated" in by_action
    deleted_audit = by_action["form_section.deleted"]
    assert deleted_audit.request_id
    assert deleted_audit.details is not None
    assert deleted_audit.details["custom_fields_unsectioned"] == 1
    assert deleted_audit.details["sales_flow_id"] == str(flow_id)


def test_form_section_audit_identifies_admin_api_key(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_api_key_factory,
) -> None:
    slug = f"api-key-section-{uuid.uuid4().hex[:8]}"
    popup = Popups(tenant_id=tenant_a.id, name=f"Popup {slug}", slug=slug)
    db.add(popup)
    db.flush()
    sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant_a.id, sale_type="application"
    )
    flow_id = default_flow_id(db, popup.id)
    db.commit()
    api_key, raw_key = admin_api_key_factory(scopes=["forms:write"])

    response = client.post(
        "/api/v1/form-sections",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={
            "popup_id": str(popup.id),
            "sales_flow_id": str(flow_id),
            "label": "Created by API key",
        },
    )

    assert response.status_code == 201, response.text
    section_id = uuid.UUID(response.json()["id"])
    audit = db.exec(
        select(AuditLog).where(
            AuditLog.action == "form_section.created",
            AuditLog.entity_id == section_id,
        )
    ).one()
    assert audit.actor_type == "api_key"
    assert audit.actor_id == api_key.id
    assert audit.details is not None
    assert audit.details["auth"]["via_api_key"] is True
    assert audit.details["auth"]["api_key_id"] == str(api_key.id)
