import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.base_field_config.schemas import BaseFieldConfigBase

if TYPE_CHECKING:
    from app.api.form_section.models import FormSections
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


class BaseFieldConfigs(BaseFieldConfigBase, table=True):
    """sdd/sales-flows slice 6: two-tier uniqueness on `field_name`.

    `uq_base_field_config_flow_field` covers flow-owned rows;
    `uq_base_field_config_popup_field_shared` re-scopes the original
    popup-wide constraint to the NULL (popup-shared) tier. See migration
    `597d9a2019ba_add_flow_id_form_definitions.py`.
    """

    __table_args__ = (
        Index(
            "uq_base_field_config_flow_field",
            "sales_flow_id",
            "field_name",
            unique=True,
            postgresql_where=text("sales_flow_id IS NOT NULL"),
        ),
        Index(
            "uq_base_field_config_popup_field_shared",
            "popup_id",
            "field_name",
            unique=True,
            postgresql_where=text("sales_flow_id IS NULL"),
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
