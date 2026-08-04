import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, func

from app.api.sales_flow.schemas import FlowProductsBase, SalesFlowBase


class FlowProducts(FlowProductsBase, table=True):
    """Link table for flow-scoped product sets."""

    __tablename__ = "flow_products"


class SalesFlows(SalesFlowBase, table=True):
    """Config-override layer between popups and every channel concern.

    Design: sdd/sales-flows — every Class B column is nullable; NULL means
    "read the popup" (D1). See sales_flow/resolver.py::build_effective_config
    for the read-through accessor — defined and unit-tested, awaiting its
    cutover consumer in a later slice.
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
