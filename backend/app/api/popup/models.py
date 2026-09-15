import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, SQLModel, func

from app.api.popup.schemas import PopupBase

if TYPE_CHECKING:
    from app.api.application.models import Applications
    from app.api.approval_strategy.models import ApprovalStrategies
    from app.api.attendee.models import Attendees
    from app.api.base_field_config.models import BaseFieldConfigs
    from app.api.coupon.models import Coupons
    from app.api.email_template.models import EmailTemplates
    from app.api.event.models import Events
    from app.api.form_field.models import FormFields
    from app.api.form_section.models import FormSections
    from app.api.group.models import Groups
    from app.api.payment.models import Payments
    from app.api.popup_reviewer.models import PopupReviewers
    from app.api.product.models import Products
    from app.api.tenant.models import Tenants
    from app.api.ticketing_step.models import TicketingSteps


class Popups(PopupBase, table=True):
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_popups_tenant_slug"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),
            primary_key=True,
        ),
    )

    tenant: "Tenants" = Relationship(back_populates="popups")

    # Popup-scoped resources
    products: list["Products"] = Relationship(
        back_populates="popup", cascade_delete=True
    )
    coupons: list["Coupons"] = Relationship(back_populates="popup", cascade_delete=True)
    groups: list["Groups"] = Relationship(back_populates="popup", cascade_delete=True)

    # Applications for this popup
    applications: list["Applications"] = Relationship(
        back_populates="popup", cascade_delete=True
    )

    # Form sections and field definitions
    form_sections: list["FormSections"] = Relationship(
        back_populates="popup", cascade_delete=True
    )
    form_fields: list["FormFields"] = Relationship(
        back_populates="popup", cascade_delete=True
    )

    # Email template customizations
    email_templates: list["EmailTemplates"] = Relationship(
        back_populates="popup", cascade_delete=True
    )

    # Approval configuration
    approval_strategies: list["ApprovalStrategies"] = Relationship(
        back_populates="popup",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    reviewers: list["PopupReviewers"] = Relationship(
        back_populates="popup", cascade_delete=True
    )

    # Base field presentation configs
    base_field_configs: list["BaseFieldConfigs"] = Relationship(
        back_populates="popup", cascade_delete=True
    )

    # Events
    events: list["Events"] = Relationship(back_populates="popup", cascade_delete=True)

    # Ticketing step configuration
    ticketing_steps: list["TicketingSteps"] = Relationship(
        back_populates="popup", cascade_delete=True
    )

    # Direct-sale reverse relationships (payments/attendees may reference popup
    # directly when sale_type == "direct" — application is optional).
    attendees: list["Attendees"] = Relationship(back_populates="popup")
    payments: list["Payments"] = Relationship(back_populates="popup")


class PopupHomePages(SQLModel, table=True):
    """Large, untrusted popup-home source kept off normal popup queries."""

    __tablename__ = "popup_home_pages"

    popup_id: uuid.UUID = Field(
        sa_column=Column(
            UUID(as_uuid=True),
            ForeignKey("popups.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    tenant_id: uuid.UUID = Field(
        sa_column=Column(
            UUID(as_uuid=True),
            ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    html: str | None = Field(default=None, sa_column=Column(Text(), nullable=True))
    version: int = Field(
        default=1,
        sa_column=Column(Integer, nullable=False, server_default="1"),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            server_default=func.now(),
            onupdate=func.now(),
            nullable=False,
        ),
    )
