"""Audit log for event CRUD operations.

One row per mutation of an event (create/update/delete/cancel/approve/etc.),
capturing who did it, from where (Portal vs Backoffice), when, on which event,
a snapshot of the relevant request data, and a field-level diff for updates.

See ``app.api.event_audit.crud.record_event_audit`` for the write path.
"""
