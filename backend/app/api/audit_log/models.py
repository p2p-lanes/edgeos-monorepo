"""ORM model for the audit_logs table.

A generic, append-only event history: one row per auditable admin action
(who did what to which entity, when, with structured before/after details).

Design notes:
- `actor_id`, `entity_id`, and `popup_id` are plain indexed UUID columns with
  NO hard foreign keys. Audit logs must outlive the entities they reference (a
  deleted user/attendee/popup must not cascade away its history), so references
  are denormalized rather than constrained. `tenant_id` keeps its FK because it
  drives Row-Level Security.
- The actor may be a backoffice `User` or a portal `Human`, so it is stored as
  flat snapshot columns (`source`, `actor_type`, `actor_id`, `actor_email`,
  `actor_name`) rather than a single FK. `actor_name`/`actor_email` and
  `entity_label` snapshot human-readable names at write time so the history
  stays readable after the referenced row is gone (the tenant DB role also
  lacks SELECT on `users`, so the actor cannot be joined at read time).
- `details` (JSONB) holds the structured payload (e.g. old/new product ids and
  names, or {snapshot, changes} for events). The frontend renders the readable
  sentence from action + details.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, DateTime, Field, SQLModel, func


class AuditLog(SQLModel, table=True):
    """A single audited admin action."""

    __tablename__ = "audit_logs"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)

    # Where the request came from: "portal" | "backoffice" | "system".
    source: str = Field(index=True)

    # Who acted. Denormalized — no FK so the log survives actor deletion, and the
    # actor may be a backoffice User or a portal Human (so a single FK won't do).
    # actor_type ∈ {user, human, api_key, system}; email/name snapshot the actor
    # at action time (the tenant DB role also cannot SELECT users to join later).
    actor_type: str = Field()
    actor_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=True), nullable=True, index=True),
    )
    actor_email: str | None = Field(default=None, nullable=True)
    actor_name: str | None = Field(default=None, nullable=True)

    # X-Request-ID of the originating request, to correlate with stdout logs.
    request_id: str | None = Field(default=None, nullable=True)

    # What happened — namespaced "<entity>.<verb>" (see AuditAction).
    action: str = Field(index=True)

    # The primary entity the event is grouped under. entity_id is polymorphic
    # (its table depends on entity_type), so it carries no FK.
    entity_type: str = Field(index=True)
    entity_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=True), nullable=True, index=True),
    )
    entity_label: str | None = Field(default=None, nullable=True)

    # Popup scope for filtering a global feed. Denormalized — no FK.
    popup_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=True), nullable=True, index=True),
    )

    # Structured before/after payload rendered by the frontend.
    details: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            server_default=func.now(),
            nullable=False,
            index=True,
        ),
    )
