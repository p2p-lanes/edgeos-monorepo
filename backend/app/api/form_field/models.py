import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.form_field.schemas import FormFieldBase

if TYPE_CHECKING:
    from app.api.form_section.models import FormSections
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


class FormFields(FormFieldBase, table=True):
    """sdd/sales-flows slice 6: two-tier uniqueness on `name`.

    `uq_form_field_name_flow` covers flow-owned rows; `uq_form_field_name_popup_shared`
    re-scopes the original popup-wide constraint to the NULL (popup-shared)
    tier. See migration `597d9a2019ba_add_flow_id_form_definitions.py`.
    """

    __table_args__ = (
        Index(
            "uq_form_field_name_flow",
            "name",
            "sales_flow_id",
            unique=True,
            postgresql_where=text("sales_flow_id IS NOT NULL"),
        ),
        Index(
            "uq_form_field_name_popup_shared",
            "name",
            "popup_id",
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

    tenant: "Tenants" = Relationship(back_populates="form_fields")
    popup: "Popups" = Relationship(back_populates="form_fields")
    section: Optional["FormSections"] = Relationship(back_populates="form_fields")
