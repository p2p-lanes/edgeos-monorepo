import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, SQLModel, func

from app.api.sales_flow.schemas import SalesFlowBase


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


class SalesFlowAliases(SQLModel, table=True):
    """A bounded historical slug for one flow in one popup."""

    __tablename__ = "sales_flow_aliases"
    __table_args__ = (
        UniqueConstraint("popup_id", "alias", name="uq_sales_flow_alias"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    sales_flow_id: uuid.UUID = Field(foreign_key="sales_flows.id", index=True)
    alias: str = Field(index=True)
    expires_at: datetime | None = Field(default=None, index=True)
