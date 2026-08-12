"""A form is judged against the flow it was shown for.

Design: sdd/sales-flows-rediseno. `validate_custom_fields` looked the
fields up by popup, so it validated against EVERY flow's questions at once.
Someone applying through a partner door was told a question from the
general door was missing — one they were never shown and had no way to
answer.

Scenarios:
- Another flow's required field does not block this flow's submission.
- This flow's own required field still does.
- Without a flow the popup-wide behaviour is unchanged, for callers that
  have none.
"""

import uuid

from sqlmodel import Session

from app.api.form_field.crud import form_fields_crud
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Form Scope {uuid.uuid4().hex[:6]}",
        slug=f"form-scope-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_flow(db: Session, popup: Popups, *, slug: str) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        type="application",
        slug=slug,
        name=slug,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _make_required_field(
    db: Session, popup: Popups, flow: SalesFlows, *, name: str, label: str
) -> FormFields:
    section = FormSections(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        label=f"Section {name}",
        order=0,
        kind="standard",
    )
    db.add(section)
    db.commit()
    db.refresh(section)

    field = FormFields(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        section_id=section.id,
        name=name,
        label=label,
        field_type="text",
        required=True,
        position=0,
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return field


class TestValidationIsFlowScoped:
    def test_another_flows_question_does_not_block_this_one(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The reported failure: submitting the Volunteers form was refused
        for a T-Shirt Size the general form asks and Volunteers never
        showed."""
        popup = _make_popup(db, tenant_a)
        general = _make_flow(db, popup, slug=f"general-{uuid.uuid4().hex[:6]}")
        partner = _make_flow(db, popup, slug=f"partner-{uuid.uuid4().hex[:6]}")
        _make_required_field(
            db, popup, general, name="tshirt_size", label="T-Shirt Size"
        )
        _make_required_field(db, popup, partner, name="why_join", label="Why join")

        is_valid, errors = form_fields_crud.validate_custom_fields(
            db,
            popup.id,
            {"why_join": "To help"},
            sales_flow_id=partner.id,
        )

        assert is_valid, errors

    def test_this_flows_own_question_still_blocks(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        partner = _make_flow(db, popup, slug=f"partner-{uuid.uuid4().hex[:6]}")
        _make_required_field(db, popup, partner, name="why_join", label="Why join")

        is_valid, errors = form_fields_crud.validate_custom_fields(
            db, popup.id, {}, sales_flow_id=partner.id
        )

        assert not is_valid
        assert any("Why join" in error for error in errors)

    def test_without_a_flow_the_whole_popup_is_still_checked(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Callers with no flow keep the behaviour they had."""
        popup = _make_popup(db, tenant_a)
        general = _make_flow(db, popup, slug=f"general-{uuid.uuid4().hex[:6]}")
        _make_required_field(
            db, popup, general, name="tshirt_size", label="T-Shirt Size"
        )

        is_valid, errors = form_fields_crud.validate_custom_fields(db, popup.id, {})

        assert not is_valid
        assert any("T-Shirt Size" in error for error in errors)
