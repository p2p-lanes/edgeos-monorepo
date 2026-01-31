import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.approval_strategy.schemas import ApprovalStrategyBase

if TYPE_CHECKING:
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


class ApprovalStrategies(ApprovalStrategyBase, table=True):
    """Approval strategy for a popup.

    Defines the rules for reviewing and accepting applications.
    """

    __table_args__ = (
        UniqueConstraint("popup_id", name="uq_approval_strategy_popup"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),  # ty:ignore[no-matching-overload]
            primary_key=True,
        ),
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    popup: "Popups" = Relationship(back_populates="approval_strategy")
    tenant: "Tenants" = Relationship()
