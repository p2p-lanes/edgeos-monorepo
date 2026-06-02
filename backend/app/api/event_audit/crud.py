"""Event-specific helpers that write to the generic audit log.

The router calls :func:`record_event_audit` after each event mutation. It builds
a snapshot (and optional field diff) of the event and persists one row through
``audit_logs_crud.record_best_effort`` (entity_type=event) — an audit failure
never breaks the user-facing mutation. The actor is resolved with the shared
``actor_from_user`` / ``actor_from_human`` helpers.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from enum import Enum
from typing import TYPE_CHECKING, Any

from sqlmodel import Session

from app.api.audit_log.actor import AuditActor
from app.api.audit_log.constants import AuditEntityType
from app.api.audit_log.crud import audit_logs_crud
from app.api.audit_log.models import AuditLog
from app.api.event_audit.schemas import EventAuditAction

if TYPE_CHECKING:
    from app.api.event.models import Events

def _snapshot_fields() -> tuple[str, ...]:
    """Fields captured in the snapshot and diffed — derived from the EventUpdate
    schema so EVERY editable field is audited automatically (no hand-maintained
    list to drift). Fields that don't map to an Events attribute resolve to None
    via getattr and are dropped from the display, so they add no noise.
    """
    from app.api.event.schemas import EventUpdate

    return tuple(EventUpdate.model_fields.keys())


def _jsonable(value: Any) -> Any:
    """Coerce a value to something JSON/JSONB-serializable and diff-stable."""
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def build_event_snapshot(session: Session, event: Events) -> dict[str, Any]:
    """Snapshot the audited fields of ``event``, resolving the venue name."""
    snapshot: dict[str, Any] = {
        field: _jsonable(getattr(event, field, None)) for field in _snapshot_fields()
    }

    venue_id = getattr(event, "venue_id", None)
    venue_name: str | None = None
    if venue_id is not None:
        from app.api.event_venue.models import EventVenues

        venue = session.get(EventVenues, venue_id)
        venue_name = venue.title if venue is not None else None
    snapshot["venue_name"] = venue_name

    track_id = getattr(event, "track_id", None)
    track_name: str | None = None
    if track_id is not None:
        from app.api.track.models import Tracks

        track = session.get(Tracks, track_id)
        track_name = track.name if track is not None else None
    snapshot["track_name"] = track_name

    return snapshot


def compute_changes(
    before: dict[str, Any], after: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Diff two snapshots → ``{field: {"old": ..., "new": ...}}`` (changed only)."""
    changes: dict[str, dict[str, Any]] = {}
    for key in before.keys() | after.keys():
        old = before.get(key)
        new = after.get(key)
        if old != new:
            changes[key] = {"old": old, "new": new}
    return changes


def record_event_audit(
    session: Session,
    *,
    event: Events,
    action: EventAuditAction,
    actor: AuditActor,
    changes: dict[str, Any] | None = None,
    snapshot: dict[str, Any] | None = None,
    event_id: uuid.UUID | None = None,
    event_title: str | None = None,
    commit: bool = True,
) -> AuditLog | None:
    """Persist one audit row for an event mutation.

    Grouped under entity_type=event so the event history is an entity_id filter.
    snapshot/changes go into the generic `details` JSONB. Pass
    ``event_id``/``event_title`` for deletes where ``event`` may be stale.

    commit=True (default): best-effort — own commit, failures swallowed. Use
    after the mutation already committed. commit=False: stage atomically in the
    caller's transaction (the caller's commit flushes it), so the audit is tied
    to the mutation — use for deletes, where the row must be read before it is
    dropped yet must not survive a failed delete.
    """
    if snapshot is None and event is not None:
        snapshot = build_event_snapshot(session, event)

    details: dict[str, Any] = {}
    if snapshot is not None:
        details["snapshot"] = snapshot
    if changes:
        details["changes"] = changes

    record_fn = (
        audit_logs_crud.record_best_effort if commit else audit_logs_crud.record
    )
    return record_fn(
        session,
        tenant_id=event.tenant_id,
        actor=actor,
        action=action.value,
        entity_type=AuditEntityType.EVENT,
        entity_id=event_id if event_id is not None else event.id,
        entity_label=event_title
        if event_title is not None
        else getattr(event, "title", None),
        popup_id=getattr(event, "popup_id", None),
        details=details or None,
    )
