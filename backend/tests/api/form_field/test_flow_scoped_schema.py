"""Tests for flow-scoped form schema resolution (sdd/sales-flows slice 6).

Design: Q1 (flow-owned forms) — `build_schema_for_popup` evolves into
`build_schema_for_flow(session, popup_id, flow_id)`. A flow with no
flow-scoped rows of its own falls back to the popup-shared tier
(`sales_flow_id IS NULL`) — identical to today's schema. A flow that owns
rows in a table uses ONLY those rows for that table; editing one flow's
form never affects another flow's (or the popup-shared tier's) schema.

`copy_form_to_flow` (the Q1 mitigation, task 6.3's backend half) copies
sections + base field configs + custom fields from a source (a flow, or
the popup-shared tier when `source_flow_id` is None) into a target flow as
independent rows.
"""

import uuid

from sqlmodel import Session

from app.api.base_field_config.crud import base_field_configs_crud
from app.api.base_field_config.models import BaseFieldConfigs
from app.api.form_field.crud import form_fields_crud
from app.api.form_field.models import FormFields
from app.api.form_section.crud import form_sections_crud
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import (
    SalesFlowIdentityMode,
    SalesFlowReviewersMode,
    SalesFlowVisibility,
)
from app.api.tenant.models import Tenants


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Flow Schema Popup {uuid.uuid4().hex[:8]}",
        slug=f"flow-schema-popup-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_flow(db: Session, tenant: Tenants, popup: Popups, *, slug: str) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=tenant.id,
        popup_id=popup.id,
        type="application",
        slug=slug,
        name=slug,
        visibility=SalesFlowVisibility.portal_listed,
        is_default=False,
        order=0,
        reviewers_mode=SalesFlowReviewersMode.inherit,
        identity_mode=SalesFlowIdentityMode.portal_auth,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _make_field(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    name: str,
    *,
    flow_id: uuid.UUID | None = None,
    section_id: uuid.UUID | None = None,
) -> FormFields:
    field = FormFields(
        tenant_id=tenant.id,
        popup_id=popup.id,
        sales_flow_id=flow_id,
        name=name,
        label=name,
        field_type="text",
        section_id=section_id,
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return field


def _make_section(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    label: str,
    *,
    flow_id: uuid.UUID | None = None,
) -> FormSections:
    section = FormSections(
        tenant_id=tenant.id,
        popup_id=popup.id,
        sales_flow_id=flow_id,
        label=label,
    )
    db.add(section)
    db.commit()
    db.refresh(section)
    return section


def _make_base_config(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    field_name: str,
    *,
    flow_id: uuid.UUID | None = None,
) -> BaseFieldConfigs:
    config = BaseFieldConfigs(
        tenant_id=tenant.id,
        popup_id=popup.id,
        sales_flow_id=flow_id,
        field_name=field_name,
        label=field_name,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


class TestBuildSchemaForFlowFallback:
    def test_flow_with_no_own_rows_falls_back_to_popup_shared_schema(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="flow-a")
        _make_field(db, tenant_a, popup, "shared_field")

        schema = form_fields_crud.build_schema_for_flow(db, popup.id, flow.id)

        assert "shared_field" in schema["custom_fields"]

    def test_none_flow_id_matches_popup_shared_schema(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_field(db, tenant_a, popup, "no_flow_field")

        with_none = form_fields_crud.build_schema_for_flow(db, popup.id, None)
        assert "no_flow_field" in with_none["custom_fields"]


class TestBuildSchemaForFlowOwnership:
    def test_flow_scoped_field_used_instead_of_popup_shared(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow_a = _make_flow(db, tenant_a, popup, slug="flow-a")
        _make_field(db, tenant_a, popup, "popup_only_field")
        _make_field(db, tenant_a, popup, "flow_a_only_field", flow_id=flow_a.id)

        schema = form_fields_crud.build_schema_for_flow(db, popup.id, flow_a.id)

        assert "flow_a_only_field" in schema["custom_fields"]
        assert "popup_only_field" not in schema["custom_fields"], (
            "Once a flow owns its own fields, the popup-shared tier must "
            "not leak into that flow's schema"
        )

    def test_editing_flow_a_does_not_affect_flow_b_schema(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow_a = _make_flow(db, tenant_a, popup, slug="flow-a")
        flow_b = _make_flow(db, tenant_a, popup, slug="flow-b")
        _make_field(db, tenant_a, popup, "flow_a_field", flow_id=flow_a.id)

        schema_a = form_fields_crud.build_schema_for_flow(db, popup.id, flow_a.id)
        schema_b = form_fields_crud.build_schema_for_flow(db, popup.id, flow_b.id)

        assert "flow_a_field" in schema_a["custom_fields"]
        assert "flow_a_field" not in schema_b["custom_fields"]


class TestCopyFormToFlow:
    def test_copy_from_popup_shared_creates_independent_field_rows(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        target = _make_flow(db, tenant_a, popup, slug="target-flow")
        _make_field(db, tenant_a, popup, "copyable_field")

        form_fields_crud.copy_form_to_flow(
            db,
            popup_id=popup.id,
            tenant_id=tenant_a.id,
            target_flow_id=target.id,
            source_flow_id=None,
        )

        target_schema = form_fields_crud.build_schema_for_flow(db, popup.id, target.id)
        assert "copyable_field" in target_schema["custom_fields"]

        # The copy is an independent row: mutating the target's copy must
        # not touch the popup-shared source.
        copied_field = db.exec(
            FormFields.__table__.select().where(
                FormFields.popup_id == popup.id,
                FormFields.sales_flow_id == target.id,
                FormFields.name == "copyable_field",
            )
        ).first()
        assert copied_field is not None
        assert copied_field.id is not None

        source_field_count = len(
            list(
                db.exec(
                    FormFields.__table__.select().where(
                        FormFields.popup_id == popup.id,
                        FormFields.sales_flow_id.is_(None),
                        FormFields.name == "copyable_field",
                    )
                )
            )
        )
        assert source_field_count == 1, "Source row must remain untouched"

    def test_copy_from_source_flow_to_target_flow_is_independent(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        source = _make_flow(db, tenant_a, popup, slug="source-flow")
        target = _make_flow(db, tenant_a, popup, slug="target-flow-2")
        section = _make_section(db, tenant_a, popup, "Profile", flow_id=source.id)
        _make_field(
            db,
            tenant_a,
            popup,
            "source_field",
            flow_id=source.id,
            section_id=section.id,
        )
        _make_base_config(db, tenant_a, popup, "first_name", flow_id=source.id)

        form_fields_crud.copy_form_to_flow(
            db,
            popup_id=popup.id,
            tenant_id=tenant_a.id,
            target_flow_id=target.id,
            source_flow_id=source.id,
        )

        target_schema = form_fields_crud.build_schema_for_flow(db, popup.id, target.id)
        assert "source_field" in target_schema["custom_fields"]
        assert "first_name" in target_schema["base_fields"]
        assert len(target_schema["sections"]) == 1
        assert target_schema["sections"][0]["label"] == "Profile"

        # Sections were remapped, not shared: the copied field's section_id
        # must point at a NEW FormSections row scoped to the target flow.
        copied_section_id = uuid.UUID(target_schema["sections"][0]["id"])
        assert copied_section_id != section.id

        source_sections, _ = form_sections_crud.find_by_flow(db, source.id)
        assert len(source_sections) == 1, "Source section must remain untouched"

        source_fields, _ = form_fields_crud.find_by_flow(db, source.id)
        assert len(source_fields) == 1, "Source field must remain untouched"

        source_configs = base_field_configs_crud.find_by_flow(db, source.id)
        assert len(source_configs) == 1, "Source base config must remain untouched"
