import uuid
from datetime import UTC, datetime

from sqlalchemy import Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, func

from app.api.attendee_category.schemas import AttendeeCategoryBase


class AttendeeCategories(AttendeeCategoryBase, table=True):
    """Attendee category configuration owned by one sales flow."""

    __tablename__ = "attendee_categories"
    __table_args__ = (
        UniqueConstraint(
            "sales_flow_id", "key", name="uq_attendee_categories_sales_flow_key"
        ),
        Index(
            "uq_attendee_categories_sales_flow_primary",
            "sales_flow_id",
            unique=True,
            postgresql_where=text("is_primary = true"),
        ),
        Index("ix_attendee_categories_tenant_id", "tenant_id"),
        Index("ix_attendee_categories_popup_id", "popup_id"),
        Index("ix_attendee_categories_sales_flow_id", "sales_flow_id"),
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
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
