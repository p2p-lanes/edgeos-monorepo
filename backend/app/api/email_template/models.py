import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import CheckConstraint, Index, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship

from app.api.email_template.schemas import EmailTemplateBase, TemplateScope
from app.services.email.templates import get_template_scope

if TYPE_CHECKING:
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


class EmailTemplates(EmailTemplateBase, table=True):
    __tablename__ = "email_templates"
    __table_args__ = (
        Index(
            "uq_email_template_popup_scope_type",
            "popup_id",
            "template_type",
            unique=True,
            postgresql_where=text("popup_id IS NOT NULL"),
        ),
        Index(
            "uq_email_template_tenant_scope_type",
            "tenant_id",
            "template_type",
            unique=True,
            postgresql_where=text("popup_id IS NULL"),
        ),
        CheckConstraint(
            "(template_type IN ('login_code_human') AND popup_id IS NULL) "
            "OR (template_type NOT IN ('login_code_human') AND popup_id IS NOT NULL)",
            name="ck_email_templates_scope",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),
            primary_key=True,
        ),
    )

    created_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        )
    )
    updated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now(), nullable=True),
    )

    tenant: "Tenants" = Relationship(back_populates="email_templates")
    popup: Optional["Popups"] = Relationship(back_populates="email_templates")

    @property
    def scope(self) -> TemplateScope:
        return get_template_scope(self.template_type)
