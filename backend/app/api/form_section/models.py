import uuid
from typing import TYPE_CHECKING

from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.form_section.schemas import FormSectionBase

if TYPE_CHECKING:
    from app.api.base_field_config.models import BaseFieldConfigs
    from app.api.form_field.models import FormFields
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


class FormSections(FormSectionBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),
            primary_key=True,
        ),
    )

    tenant: "Tenants" = Relationship(back_populates="form_sections")
    popup: "Popups" = Relationship(back_populates="form_sections")
    form_fields: list["FormFields"] = Relationship(back_populates="section")
    base_field_configs: list["BaseFieldConfigs"] = Relationship(
        back_populates="section"
    )
