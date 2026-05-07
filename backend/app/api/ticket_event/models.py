"""ORM model for ticket_events event log table.

Addendum #12: maps to ticket_events as created by migration 0045_ticket_events_log.
Stores per-ticket lifecycle events (check_in, future: transfer, refund, edit).
"""

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, DateTime, Field, Relationship, SQLModel, func

if TYPE_CHECKING:
    from app.api.attendee.models import AttendeeProducts


class TicketEvent(SQLModel, table=True):
    """Event log entry for a single ticket (AttendeeProducts row).

    event_type discriminates the payload shape:
      - 'check_in': CheckInPayload (source, gate, device_id, notes)
      - future: 'transfer', 'refund', 'edit'

    actor_user_id is NULL for system-generated events.
    ON DELETE CASCADE (enforced at DB level) ensures orphaned events are removed
    with their ticket.
    """

    __tablename__ = "ticket_events"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id")

    attendee_product_id: uuid.UUID = Field(foreign_key="attendee_products.id")

    event_type: str = Field(max_length=32)

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
    attendee_product: "AttendeeProducts" = Relationship()  # type: ignore[assignment]
