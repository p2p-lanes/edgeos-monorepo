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


class AuditEntityType:
    """Type of the primary entity an event is grouped under."""

    ATTENDEE = "attendee"
    HUMAN = "human"
    PRODUCT = "product"
