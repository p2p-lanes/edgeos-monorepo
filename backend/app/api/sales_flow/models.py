import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, func

from app.api.sales_flow.schemas import SalesFlowBase

if TYPE_CHECKING:
    from app.api.base_field_config.models import BaseFieldConfigs
    from app.api.form_field.models import FormFields
    from app.api.form_section.models import FormSections


class SalesFlows(SalesFlowBase, table=True):
    """Config-override layer between popups and every channel concern.

    Design: sdd/sales-flows — every Class B column is nullable; NULL means
    "read the popup" (D1). See sales_flow/resolver.py::build_effective_config
    for the read-through accessor — live consumers: `reminder_dispatch.py`
    (slice 10, reminder cadence) and `coupon/crud.py` (slice 11,
    `allows_coupons`).
    """

    __tablename__ = "sales_flows"
    __table_args__ = (
        UniqueConstraint("popup_id", "slug", name="uq_sales_flows_popup_slug"),
        UniqueConstraint(
            "id", "popup_id", "tenant_id", name="uq_sales_flows_id_popup_tenant"
        ),
        CheckConstraint(
            "type IN ('application', 'direct', 'upsale')",
            name="ck_sales_flows_type",
        ),
        CheckConstraint(
            "visibility IN ('portal_listed', 'direct_url_only')",
            name="ck_sales_flows_visibility",
        ),
        CheckConstraint(
            "reviewers_mode IN ('inherit', 'override')",
            name="ck_sales_flows_reviewers_mode",
        ),
        CheckConstraint(
            "ticket_sales_status IN ('open', 'coming_soon')",
            name="ck_sales_flows_ticket_sales_status",
        ),
        Index(
            "uq_sales_flows_default_per_popup",
            "popup_id",
            unique=True,
            postgresql_where=text("is_default"),
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

    form_sections: list["FormSections"] = Relationship(
        back_populates="sales_flow",
        sa_relationship_kwargs={
            "foreign_keys": "FormSections.sales_flow_id",
            "passive_deletes": "all",
        },
    )
    form_fields: list["FormFields"] = Relationship(
        back_populates="sales_flow",
        cascade_delete=True,
        sa_relationship_kwargs={"foreign_keys": "FormFields.sales_flow_id"},
    )
    base_field_configs: list["BaseFieldConfigs"] = Relationship(
        back_populates="sales_flow",
        cascade_delete=True,
        sa_relationship_kwargs={"foreign_keys": "BaseFieldConfigs.sales_flow_id"},
    )
