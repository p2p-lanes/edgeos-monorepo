import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, func

from app.api.attendee_category.schemas import AttendeeCategoryBase

if TYPE_CHECKING:
    pass


class AttendeeCategories(AttendeeCategoryBase, table=True):
    """Per-popup attendee category — replaces the hardcoded main|spouse|kid enum."""

    __tablename__ = "attendee_categories"
    __table_args__ = (
        UniqueConstraint("popup_id", "key", name="uq_attendee_categories_popup_key"),
        Index("ix_attendee_categories_tenant_id", "tenant_id"),
        Index("ix_attendee_categories_popup_id", "popup_id"),
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
