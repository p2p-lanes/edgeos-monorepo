"""Schemas for the event audit log."""

import uuid
from dataclasses import dataclass
from enum import Enum


class EventAuditAction(str, Enum):
    """Every kind of event mutation we audit."""

    CREATED = "created"
    UPDATED = "updated"
    DELETED = "deleted"
    CANCELLED = "cancelled"
    APPROVED = "approved"
    REJECTED = "rejected"
    RECURRENCE_SET = "recurrence_set"
    OCCURRENCE_DETACHED = "occurrence_detached"
    OCCURRENCE_SKIPPED = "occurrence_skipped"
    INVITATION_ADDED = "invitation_added"
    INVITATION_REMOVED = "invitation_removed"
    HIDDEN = "hidden"
    UNHIDDEN = "unhidden"


class EventAuditSource(str, Enum):
    """Originating application."""

    PORTAL = "portal"
    BACKOFFICE = "backoffice"


class EventAuditActorType(str, Enum):
    USER = "user"
    HUMAN = "human"
    API_KEY = "api_key"
    SYSTEM = "system"


@dataclass(frozen=True)
class AuditActor:
    """Resolved identity of whoever performed an event mutation.

    Built from the request's auth principal via
    ``app.api.event_audit.crud.actor_from_user`` / ``actor_from_human``.
    """

    type: EventAuditActorType
    source: EventAuditSource
    id: uuid.UUID | None = None
    email: str | None = None
    name: str | None = None
