"""ORM model for the email_logs table.

An append-only history of every email the platform dispatches: one row per
send attempt (which template went to whom, for which popup/entity, and whether
it left the SMTP server).

Design notes:
- `popup_id`, `application_id`, `payment_id`, and `human_id` are plain indexed
  UUID columns with NO hard foreign keys. Email logs must outlive the entities
  they reference (a deleted application/payment must not cascade away its
  delivery history), so references are denormalized rather than constrained.
  `tenant_id` keeps its FK because it drives Row-Level Security.
- This table is the source of truth for the reminder dispatcher: cadence and
  send caps are computed by counting `sent` rows per (template_type, entity),
  so no separate reminder-tracking table is needed.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, SQLModel, func


class EmailLogs(SQLModel, table=True):
    """A single dispatched email event."""

    __tablename__ = "email_logs"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)

    # Popup scope for filtering. Denormalized — no FK.
    popup_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=True), nullable=True, index=True),
    )

    # The EmailTemplateType value that was rendered.
    template_type: str = Field(index=True)

    to_email: str = Field(index=True)

    # Entities the email relates to. Polymorphic references, denormalized so the
    # log survives their deletion and never blocks a cascade.
    application_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=True), nullable=True, index=True),
    )
    payment_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=True), nullable=True, index=True),
    )
    human_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=True), nullable=True, index=True),
    )

    subject: str | None = Field(default=None, nullable=True)

    # EmailLogStatus value: "sent" | "failed".
    status: str = Field(index=True)

    # SMTP/render error detail when status is "failed".
    error: str | None = Field(default=None, sa_column=Column(Text(), nullable=True))

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            server_default=func.now(),
            nullable=False,
            index=True,
        ),
    )
