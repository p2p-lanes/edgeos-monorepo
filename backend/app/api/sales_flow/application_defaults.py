import uuid

from sqlmodel import Session

from app.api.base_field_config.constants import DEFAULT_SECTIONS
from app.api.base_field_config.crud import base_field_configs_crud
from app.api.form_section.crud import form_sections_crud
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.resolver import build_effective_config
from app.api.sales_flow.schemas import SalesFlowType


def seed_application_defaults(
    session: Session,
    *,
    popup: Popups,
    flow: SalesFlows,
) -> None:
    """Seed the form baseline owned by one application flow."""
    if flow.type != SalesFlowType.application:
        return

    sections, _ = form_sections_crud.find_by_flow(session, flow.id, limit=None)
    sections_by_label = {section.label: section for section in sections}

    section_map: dict[str, uuid.UUID] = {}
    for key, section_def in DEFAULT_SECTIONS.items():
        if key == "scholarship" and not build_effective_config(flow).allows_scholarship:
            continue

        section = sections_by_label.get(section_def["label"])
        if section is None and key == "scholarship":
            section = next(
                (item for item in sections if item.kind == section_def["kind"]), None
            )
        if section is None:
            section = FormSections(
                tenant_id=popup.tenant_id,
                popup_id=popup.id,
                sales_flow_id=flow.id,
                label=section_def["label"],
                order=section_def["order"],
                protected=True,
                kind=section_def["kind"],
            )
            session.add(section)
        section_map[key] = section.id

    base_field_configs_crud.create_defaults_for_popup(
        session,
        popup_id=popup.id,
        tenant_id=popup.tenant_id,
        sales_flow_id=flow.id,
        section_map=section_map,
        commit=False,
    )
