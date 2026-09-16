import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, func

from app.api.popup_reviewer.schemas import PopupReviewerBase

if TYPE_CHECKING:
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants
    from app.api.user.models import Users


class PopupReviewers(PopupReviewerBase, table=True):
    """Designated reviewer for a popup.

    Assigns a user as a reviewer for applications to a specific popup, or —
    when `sales_flow_id` is set — to one specific sales flow of that popup
    only (sdd/sales-flows slice 7, D4). `uq_popup_reviewer_flow` covers
    flow-owned rows; `uq_popup_reviewer_popup_shared` re-scopes the
    original popup-wide constraint to the NULL (popup-shared) tier. See
    migration `9bf2a7a71d10_add_flow_id_to_reviewers.py`.
    """

    __table_args__ = (
        Index(
            "uq_popup_reviewer_flow",
            "sales_flow_id",
            "user_id",
            unique=True,
            postgresql_where=text("sales_flow_id IS NOT NULL"),
        ),
        Index(
            "uq_popup_reviewer_popup_shared",
            "popup_id",
            "user_id",
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

    # Relationships
    popup: "Popups" = Relationship(back_populates="reviewers")
    user: "Users" = Relationship()
    tenant: "Tenants" = Relationship()
