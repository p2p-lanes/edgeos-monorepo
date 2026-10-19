import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import ForeignKeyConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.base_field_config.schemas import BaseFieldConfigBase

if TYPE_CHECKING:
    from app.api.form_section.models import FormSections
    from app.api.sales_flow.models import SalesFlows


class BaseFieldConfigs(BaseFieldConfigBase, table=True):
    """Base-field presentation configuration owned by one sales flow."""

    __table_args__ = (
        ForeignKeyConstraint(
            ["sales_flow_id", "popup_id", "tenant_id"],
            ["sales_flows.id", "sales_flows.popup_id", "sales_flows.tenant_id"],
            name="fk_basefieldconfigs_flow_scope",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["section_id", "sales_flow_id", "popup_id", "tenant_id"],
            [
                "formsections.id",
                "formsections.sales_flow_id",
                "formsections.popup_id",
                "formsections.tenant_id",
            ],
            name="fk_basefieldconfigs_section_flow_scope",
        ),
        Index(
            "uq_base_field_config_flow_field",
            "sales_flow_id",
            "field_name",
            unique=True,
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),
            primary_key=True,
        ),
    )

    sales_flow: "SalesFlows" = Relationship(
        back_populates="base_field_configs",
        sa_relationship_kwargs={"foreign_keys": "BaseFieldConfigs.sales_flow_id"},
    )
    section: Optional["FormSections"] = Relationship(
        back_populates="base_field_configs",
        sa_relationship_kwargs={
            "foreign_keys": "BaseFieldConfigs.section_id",
            "viewonly": True,
        },
    )
