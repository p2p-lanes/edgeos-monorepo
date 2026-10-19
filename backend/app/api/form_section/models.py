import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.form_section.schemas import FormSectionBase

if TYPE_CHECKING:
    from app.api.base_field_config.models import BaseFieldConfigs
    from app.api.form_field.models import FormFields
    from app.api.sales_flow.models import SalesFlows


class FormSections(FormSectionBase, table=True):
    __tablename__ = "formsections"
    __table_args__ = (
        UniqueConstraint(
            "id",
            "sales_flow_id",
            "popup_id",
            "tenant_id",
            name="uq_form_sections_flow_scope",
        ),
        ForeignKeyConstraint(
            ["sales_flow_id", "popup_id", "tenant_id"],
            ["sales_flows.id", "sales_flows.popup_id", "sales_flows.tenant_id"],
            name="fk_form_sections_flow_scope",
            ondelete="CASCADE",
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
        back_populates="form_sections",
        sa_relationship_kwargs={"foreign_keys": "FormSections.sales_flow_id"},
    )
    form_fields: list["FormFields"] = Relationship(
        back_populates="section",
        sa_relationship_kwargs={
            "foreign_keys": "FormFields.section_id",
            "viewonly": True,
        },
    )
    base_field_configs: list["BaseFieldConfigs"] = Relationship(
        back_populates="section",
        sa_relationship_kwargs={
            "foreign_keys": "BaseFieldConfigs.section_id",
            "viewonly": True,
        },
    )
