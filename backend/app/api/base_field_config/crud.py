import uuid
from typing import TYPE_CHECKING

from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.base_field_config.constants import BASE_FIELD_DEFINITIONS
from app.api.base_field_config.models import BaseFieldConfigs
from app.api.base_field_config.schemas import BaseFieldConfigUpdate
from app.api.form_section.models import FormSections
from app.api.shared.crud import BaseCRUD

if TYPE_CHECKING:
    from app.api.popup.models import Popups

SPOUSE_FIELDS = frozenset({"partner", "partner_email"})
CHILDREN_FIELDS = frozenset({"kids"})
SCHOLARSHIP_FIELDS = frozenset(
    {"scholarship_request", "scholarship_details", "scholarship_video_url"}
)


def field_applies_to_popup(field_name: str, popup: "Popups") -> bool:
    """Return True if the given base field is allowed by the popup's flags."""
    if field_name in SPOUSE_FIELDS and not popup.allows_spouse:
        return False
    if field_name in CHILDREN_FIELDS and not popup.allows_children:
        return False
    if field_name in SCHOLARSHIP_FIELDS and not popup.allows_scholarship:
        return False
    return True


class BaseFieldConfigsCRUD(
    BaseCRUD[BaseFieldConfigs, BaseModel, BaseFieldConfigUpdate]
):
    def __init__(self) -> None:
        super().__init__(BaseFieldConfigs)

    def find_by_popup(
        self, session: Session, popup_id: uuid.UUID
    ) -> list[BaseFieldConfigs]:
        # Order by (section.order, position) so callers that don't regroup still
        # render fields in the same visual order as the form builder: sections
        # stay together instead of being interleaved by raw position value.
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

    def create_defaults_for_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
        section_map: dict[str, uuid.UUID],
    ) -> list[BaseFieldConfigs]:
        """Create one BaseFieldConfig per base field for a popup.

        Idempotent: existing (popup_id, field_name) rows are left untouched.
        This matters when a feature flag is toggled on, off, and back on —
        configs persist across the off cycle and must not be re-inserted.

        Args:
            session: DB session
            popup_id: The popup to create configs for
            tenant_id: Tenant owning the popup
            section_map: Maps section keys (e.g. "profile") to FormSection UUIDs
        """
        existing_names = {
            c.field_name
            for c in session.exec(
                select(BaseFieldConfigs).where(BaseFieldConfigs.popup_id == popup_id)
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
