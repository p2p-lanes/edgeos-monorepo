"""ORM model for the check_ins table.

One row per scan event with full history (re-scans append rows). Backed by
the `check_ins` table renamed from the original `ticket_events` table.
"""

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, DateTime, Field, Relationship, SQLModel, func

if TYPE_CHECKING:
    from app.api.attendee.models import AttendeeProducts


class CheckIn(SQLModel, table=True):
    """A single check-in event for an AttendeeProducts (ticket) row.

    actor_user_id is NULL for system-generated events.
    ON DELETE CASCADE (enforced at DB level) ensures orphaned events are
    removed with their ticket.
    """

    __tablename__ = "check_ins"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id")

    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)

    attendee_product_id: uuid.UUID = Field(foreign_key="attendee_products.id")

    occurred_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            server_default=func.now(),
            nullable=False,
        ),
    )

    actor_user_id: uuid.UUID | None = Field(
        default=None,
        foreign_key="users.id",
        nullable=True,
    )

    payload: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            server_default=func.now(),
            nullable=False,
        ),
    )

    # Relationship — used by router for eager loading; not in DB schema.
    # NOTE: no relationship to Users — tenant_role lacks SELECT on users.
    # The router resolves actor_user_id → name/email via a batch query on the
    # main engine (see application_review/router._get_reviewer_details for the
    # established pattern).
    attendee_product: "AttendeeProducts" = Relationship()  # type: ignore[assignment]
