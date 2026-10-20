"""Integration tests for Popup CRUD after tier schema removal (spec: migration-backfill).

Scenarios:
1. PATCH popup with tier_progression_enabled: true → 422 (extra field rejected).
   (T1.7b / Spec: migration-backfill, Scenario 3 — schema rejects deprecated tier fields)
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.base_field_config.models import BaseFieldConfigs
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# T1.7b — tier_progression_enabled rejected with 422 on PATCH popup
# ---------------------------------------------------------------------------


def test_patch_popup_with_tier_progression_enabled_returns_422(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """PATCH popup with tier_progression_enabled: true → 422 extra-field rejection.

    After removing tier_progression_enabled from PopupUpdate, Pydantic rejects
    extra fields because the schema no longer declares it.
    """
    resp = client.patch(
        f"/api/v1/popups/{popup_tenant_a.id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"tier_progression_enabled": True},
    )
    # Pydantic v2 extra-field rejection returns 422 Unprocessable Entity.
    assert resp.status_code == 422, resp.text


def test_deleting_popup_cascades_through_each_flow_owned_form(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    popup = Popups(
        tenant_id=tenant_a.id,
        name="Popup with flow-owned forms",
        slug=f"flow-form-delete-{uuid.uuid4().hex[:8]}",
        sale_type="direct",
    )
    db.add(popup)
    db.flush()
    default_flow = sales_flows_crud.provision_default_flow(
        db,
        popup_id=popup.id,
        tenant_id=tenant_a.id,
        sale_type="direct",
    )
    assert default_flow is not None
    second_flow = SalesFlows(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        slug=f"second-{uuid.uuid4().hex[:8]}",
        name="Second flow",
        type="direct",
    )
    db.add(second_flow)
    db.flush()

    for flow, suffix in ((default_flow, "default"), (second_flow, "second")):
        section = FormSections(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            label=f"Contact {suffix}",
        )
        db.add(section)
        db.flush()
        db.add(
            FormFields(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                sales_flow_id=flow.id,
                section_id=section.id,
                name=f"contact_{suffix}",
                label=f"Contact {suffix}",
                field_type="text",
            )
        )
        db.add(
            BaseFieldConfigs(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                sales_flow_id=flow.id,
                field_name="referral",
                section_id=section.id,
            )
        )
    db.commit()

    response = client.delete(
        f"/api/v1/popups/{popup.id}",
        headers=_admin_headers(admin_token_tenant_a),
    )

    assert response.status_code == 204, response.text
    assert not db.exec(
        select(FormSections).where(FormSections.popup_id == popup.id)
    ).all()
    assert not db.exec(select(FormFields).where(FormFields.popup_id == popup.id)).all()
    assert not db.exec(
        select(BaseFieldConfigs).where(BaseFieldConfigs.popup_id == popup.id)
    ).all()
