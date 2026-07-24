import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, SQLModel, func

from app.api.application_review.schemas import ApplicationReviewBase

if TYPE_CHECKING:
    from app.api.application.models import Applications
    from app.api.tenant.models import Tenants
    from app.api.user.models import Users


class ApplicationReviews(ApplicationReviewBase, table=True):
    """Individual review for an application.

    Records a reviewer's decision on a specific application.
    Each reviewer can only submit one review per application.
    """

    __table_args__ = (
        UniqueConstraint("application_id", "reviewer_id", name="uq_review_app_user"),
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
    application: "Applications" = Relationship(back_populates="reviews")
    reviewer: "Users" = Relationship()
    tenant: "Tenants" = Relationship()


class ApplicationReviewSkips(SQLModel, table=True):
    """A reviewer's decision to skip (pass on) an application.

    A skip removes the application from that one reviewer's pending queue
    without recording a vote, so it never affects the approval tally. One skip
    per reviewer per application.
    """

    __tablename__ = "application_review_skips"
    __table_args__ = (
        UniqueConstraint(
            "application_id", "reviewer_id", name="uq_review_skip_app_user"
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    application_id: uuid.UUID = Field(foreign_key="applications.id", index=True)
    reviewer_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)

    reason: str | None = Field(default=None, sa_type=Text)

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
