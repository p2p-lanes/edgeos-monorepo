import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.base_field_config.schemas import BaseFieldConfigBase

if TYPE_CHECKING:
    from app.api.form_section.models import FormSections
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


class BaseFieldConfigs(BaseFieldConfigBase, table=True):
    __table_args__ = (
        UniqueConstraint(
            "popup_id", "field_name", name="uq_base_field_config_popup_field"
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),
            primary_key=True,
        ),
    )

    tenant: "Tenants" = Relationship(back_populates="base_field_configs")
    popup: "Popups" = Relationship(back_populates="base_field_configs")
    section: Optional["FormSections"] = Relationship(
        back_populates="base_field_configs"
    )
