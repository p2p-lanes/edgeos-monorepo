"""Event-specific audit actions.

These are stored in the generic `audit_logs.action` column, namespaced
`event.<verb>` so they share the action space with ticket.* and any future
entity. Event rows live in the same table as every other audit event.
"""

from enum import Enum


class EventAuditAction(str, Enum):
    """Every kind of event mutation we audit."""

    CREATED = "event.created"
    UPDATED = "event.updated"
    DELETED = "event.deleted"
    CANCELLED = "event.cancelled"
    APPROVED = "event.approved"
    REJECTED = "event.rejected"
    RECURRENCE_SET = "event.recurrence_set"
    OCCURRENCE_DETACHED = "event.occurrence_detached"
    OCCURRENCE_SKIPPED = "event.occurrence_skipped"
    INVITATION_ADDED = "event.invitation_added"
    INVITATION_REMOVED = "event.invitation_removed"
    HIDDEN = "event.hidden"
    UNHIDDEN = "event.unhidden"
