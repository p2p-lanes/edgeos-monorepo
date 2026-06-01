"""ORM model for the event_audit_logs table.

One row per event mutation. Appends-only history: never updated or deleted by
application code. Mirrors the storage style of ``app.api.check_in.models``.

Unlike check_ins, the actor can be either a backoffice ``User`` (token type
``user``) or a portal ``Human`` (token type ``human``), so the actor is stored
as flat columns (``actor_type``/``actor_id`` + email/name snapshots) rather than
a single foreign key. ``event_id`` is stored WITHOUT a foreign key so the audit
row survives a hard-delete of the event it describes.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, DateTime, Field, SQLModel, func


class EventAuditLog(SQLModel, table=True):
    """A single audit entry for an event mutation."""

    __tablename__ = "event_audit_logs"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)

    # Popup the event belongs to. Nullable so an audit row can still be written
    # if the popup is somehow unavailable; indexed for "history of this popup".
    popup_id: uuid.UUID | None = Field(default=None, index=True)

    # The event this row describes. NOT a foreign key on purpose: the log must
    # outlive a hard delete of the event row.
    event_id: uuid.UUID = Field(
        sa_column=Column(UUID(as_uuid=True), nullable=False, index=True)
    )

    # Snapshot of the event title at action time (survives rename/delete).
    event_title: str | None = Field(default=None, sa_column=Column(Text, nullable=True))

    # What happened — see app.api.event_audit.schemas.EventAuditAction.
    action: str = Field(max_length=24)

    # Where the request came from: "portal" or "backoffice".
    source: str = Field(max_length=16)

    # Actor identity. actor_type ∈ {user, human, api_key, system}.
    actor_type: str = Field(max_length=8)
    actor_id: uuid.UUID | None = Field(default=None, nullable=True)
    actor_email: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    actor_name: str | None = Field(default=None, sa_column=Column(Text, nullable=True))

    # X-Request-ID of the originating request, to correlate with stdout logs.
    request_id: str | None = Field(default=None, max_length=64, nullable=True)

    # Snapshot of the relevant event fields at action time: title, start_time,
    # end_time, timezone, venue_id, venue_name, visibility, status.
    snapshot: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )

    # Field-level diff for updates: {field: {"old": ..., "new": ...}}.
    changes: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )

    occurred_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            server_default=func.now(),
            nullable=False,
        ),
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            server_default=func.now(),
            nullable=False,
        ),
    )
