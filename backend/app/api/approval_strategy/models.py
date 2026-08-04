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
    """Approval strategy for a popup, or — when `flow_id` is set — for one
    specific sales flow of that popup only (sdd/sales-flows slice 7).

    Defines the rules for reviewing and accepting applications.
    `uq_approval_strategy_flow` covers flow-owned rows;
    `uq_approval_strategy_popup_shared` re-scopes the original popup-wide
    constraint to the NULL (popup-shared) tier. See migration
    `9bf2a7a71d10_add_flow_id_to_reviewers.py`.
    """

    __table_args__ = (
        Index(
            "uq_approval_strategy_flow",
            "flow_id",
            unique=True,
            postgresql_where=text("flow_id IS NOT NULL"),
        ),
        Index(
            "uq_approval_strategy_popup_shared",
            "popup_id",
            unique=True,
            postgresql_where=text("flow_id IS NULL"),
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
    popup: "Popups" = Relationship(back_populates="approval_strategy")
    tenant: "Tenants" = Relationship()
