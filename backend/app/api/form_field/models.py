import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import ForeignKeyConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.form_field.schemas import FormFieldBase

if TYPE_CHECKING:
    from app.api.form_section.models import FormSections
    from app.api.sales_flow.models import SalesFlows


class FormFields(FormFieldBase, table=True):
    """Custom field definition owned by one sales flow."""

    __table_args__ = (
        ForeignKeyConstraint(
            ["sales_flow_id", "popup_id", "tenant_id"],
            ["sales_flows.id", "sales_flows.popup_id", "sales_flows.tenant_id"],
            name="fk_formfields_flow_scope",
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
            name="fk_formfields_section_flow_scope",
        ),
        Index(
            "uq_form_field_name_flow",
            "name",
            "sales_flow_id",
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
        back_populates="form_fields",
        sa_relationship_kwargs={"foreign_keys": "FormFields.sales_flow_id"},
    )
    section: Optional["FormSections"] = Relationship(
        back_populates="form_fields",
        sa_relationship_kwargs={
            "foreign_keys": "FormFields.section_id",
            "viewonly": True,
        },
    )
