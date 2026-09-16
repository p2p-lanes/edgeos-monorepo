import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, func

from app.api.approval_strategy.schemas import ApprovalStrategyBase

if TYPE_CHECKING:
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


class ApprovalStrategies(ApprovalStrategyBase, table=True):
    """How a gathering or one application flow accepts applications.

    A row without ``sales_flow_id`` is the gathering default. Application
    flows may own an override; direct and upsale flows never do.
    """

    __table_args__ = (
        Index(
            "uq_approval_strategy_flow",
            "sales_flow_id",
            unique=True,
            postgresql_where=text("sales_flow_id IS NOT NULL"),
        ),
        Index(
            "uq_approval_strategy_popup_shared",
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

    # Relationships
    popup: "Popups" = Relationship(back_populates="approval_strategies")
    tenant: "Tenants" = Relationship()
