import uuid

from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.base_field_config.constants import BASE_FIELD_DEFINITIONS
from app.api.base_field_config.models import BaseFieldConfigs
from app.api.base_field_config.schemas import BaseFieldConfigUpdate
from app.api.shared.crud import BaseCRUD


class BaseFieldConfigsCRUD(
    BaseCRUD[BaseFieldConfigs, BaseModel, BaseFieldConfigUpdate]
):
    def __init__(self) -> None:
        super().__init__(BaseFieldConfigs)

    def find_by_popup(
        self, session: Session, popup_id: uuid.UUID
    ) -> list[BaseFieldConfigs]:
        statement = (
            select(BaseFieldConfigs)
            .where(BaseFieldConfigs.popup_id == popup_id)
            .order_by(BaseFieldConfigs.position)
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

        Args:
            session: DB session
            popup_id: The popup to create configs for
            tenant_id: Tenant owning the popup
            section_map: Maps section keys (e.g. "profile") to FormSection UUIDs
        """
        configs = []
        for field_name, definition in BASE_FIELD_DEFINITIONS.items():
            section_key = definition.get("default_section_key", "profile")
            config = BaseFieldConfigs(
                tenant_id=tenant_id,
                popup_id=popup_id,
                field_name=field_name,
                section_id=section_map.get(section_key),
                position=definition.get("default_position", 0),
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
