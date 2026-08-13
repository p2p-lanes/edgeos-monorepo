import uuid
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.base_field_config.constants import BASE_FIELD_DEFINITIONS
from app.api.base_field_config.models import BaseFieldConfigs
from app.api.base_field_config.schemas import BaseFieldConfigUpdate
from app.api.form_section.models import FormSections
from app.api.shared.crud import BaseCRUD

if TYPE_CHECKING:
    from app.api.sales_flow.schemas import EffectiveFlowConfig

SCHOLARSHIP_FIELDS = frozenset(
    {"scholarship_request", "scholarship_details", "scholarship_video_url"}
)


def field_applies_to_flow(field_name: str, config: "EffectiveFlowConfig") -> bool:
    """Whether a base field is asked at all, given what its flow decided.

    Base field configs belong to a flow, so the flag that hides one has to
    come from the same flow — asking the popup meant a scholarship question
    appeared or vanished on every way in at once.
    """
    if field_name in SCHOLARSHIP_FIELDS and not config.allows_scholarship:
        return False
    return True


def ensure_base_field_update_allowed(
    config: BaseFieldConfigs, update_fields: dict[str, Any]
) -> None:
    """Enforce catalog invariants on a base field config update.

    ``update_fields`` must contain only the keys the caller explicitly sent
    (``model_dump(exclude_unset=True)``). Shared by the /form-fields and
    /base-field-configs update routes so both enforce the same rules.
    """
    definition = BASE_FIELD_DEFINITIONS.get(config.field_name, {})

    # Non-removable elementals (first_name, last_name) cannot be made optional.
    if (
        not definition.get("removable", True)
        and "required" in update_fields
        and update_fields["required"] is False
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Field '{config.field_name}' is required and cannot be made optional",
        )

    # `field_type` is only writeable on base configs whose catalog entry
    # whitelists alternatives — and only to a value inside that whitelist.
    if "field_type" in update_fields:
        allowed_field_types = definition.get("allowed_field_types")
        if not allowed_field_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Field '{config.field_name}' does not allow type overrides",
            )
        new_type = update_fields["field_type"]
        if new_type is not None and new_type not in allowed_field_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Field type '{new_type}' is not allowed for '{config.field_name}'"
                ),
            )


class BaseFieldConfigsCRUD(
    BaseCRUD[BaseFieldConfigs, BaseModel, BaseFieldConfigUpdate]
):
    def __init__(self) -> None:
        super().__init__(BaseFieldConfigs)

    def find_by_popup(
        self, session: Session, popup_id: uuid.UUID
    ) -> list[BaseFieldConfigs]:
        """Returns ALL configs for the popup regardless of `sales_flow_id`
        (admin/legacy management surface — untouched by sdd/sales-flows
        slice 6 — see `find_by_flow` for one flow's own configs).

        Order by (section.order, position) so callers that don't regroup still
        render fields in the same visual order as the form builder: sections
        stay together instead of being interleaved by raw position value.
        """
        statement = (
            select(BaseFieldConfigs)
            .outerjoin(
                FormSections,
                BaseFieldConfigs.section_id == FormSections.id,  # type: ignore[arg-type]
            )
            .where(BaseFieldConfigs.popup_id == popup_id)
            .order_by(FormSections.order, BaseFieldConfigs.position)  # type: ignore[arg-type]
        )
        return list(session.exec(statement).all())

    def find_by_flow(
        self, session: Session, flow_id: uuid.UUID
    ) -> list[BaseFieldConfigs]:
        """The base-field configs of `flow_id` — no fallback (slice 3)."""
        statement = (
            select(BaseFieldConfigs)
            .outerjoin(
                FormSections,
                BaseFieldConfigs.section_id == FormSections.id,  # type: ignore[arg-type]
            )
            .where(BaseFieldConfigs.sales_flow_id == flow_id)
            .order_by(FormSections.order, BaseFieldConfigs.position)  # type: ignore[arg-type]
        )
        return list(session.exec(statement).all())

    def create_defaults_for_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
        sales_flow_id: uuid.UUID,
        section_map: dict[str, uuid.UUID],
    ) -> list[BaseFieldConfigs]:
        """Create one BaseFieldConfig per base field, owned by one flow.

        `sales_flow_id` is required (sdd/sales-flows-rediseno slice 3): a
        config belongs to a flow's form, and popup creation passes the
        default flow it just provisioned.

        Idempotent: existing (sales_flow_id, field_name) rows are left
        untouched. This matters when a feature flag is toggled on, off, and
        back on — configs persist across the off cycle and must not be
        re-inserted.
        """
        existing_names = {
            c.field_name
            for c in session.exec(
                select(BaseFieldConfigs).where(
                    BaseFieldConfigs.sales_flow_id == sales_flow_id
                )
            ).all()
        }

        configs = []
        for field_name, definition in BASE_FIELD_DEFINITIONS.items():
            if field_name in existing_names:
                continue
            section_key = definition.get("default_section_key", "profile")
            # Skip fields whose section was not created (e.g. scholarship when not enabled)
            if section_key not in section_map:
                continue
            config = BaseFieldConfigs(
                tenant_id=tenant_id,
                popup_id=popup_id,
                sales_flow_id=sales_flow_id,
                field_name=field_name,
                section_id=section_map.get(section_key),
                position=definition.get("default_position", 0),
                required=definition.get("required", False),
                label=definition.get("label"),
                placeholder=definition.get("default_placeholder"),
                help_text=definition.get("default_help_text"),
                options=definition.get("default_options"),
            )
            session.add(config)
            configs.append(config)

        session.commit()
        for config in configs:
            session.refresh(config)
        return configs


base_field_configs_crud = BaseFieldConfigsCRUD()
