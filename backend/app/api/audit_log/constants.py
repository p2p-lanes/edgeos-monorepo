"""Stable string constants for the audit log.

Actions are namespaced as `<entity>.<verb>`. Adding a new auditable event is
just a new constant here plus a single `audit_logs_crud.record(...)` call at the
mutation site — the table and read API do not change.
"""


class AuditAction:
    """Namespaced action identifiers stored in `audit_logs.action`."""

    TICKET_SWAP = "ticket.swap"
    TICKET_ADD = "ticket.add"
    TICKET_REMOVE = "ticket.remove"
    TICKET_GRANT = "ticket.grant"

    # Manual activity note added to a human from the backoffice timeline.
    HUMAN_NOTE_ADDED = "human.note_added"

    # A human's rating (red/orange/green flag, star, …) was changed by a user.
    HUMAN_RATING_CHANGED = "human.rating_changed"


class AuditEntityType:
    """Type of the primary entity an event is grouped under."""

    ATTENDEE = "attendee"
    EVENT = "event"
    HUMAN = "human"
    PRODUCT = "product"
