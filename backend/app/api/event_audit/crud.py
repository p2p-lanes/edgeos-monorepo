"""Event-specific audit layer over the generic audit log.

Thin by design: the snapshot/diff/record machinery is generic (see
``app.api.audit_log.snapshot`` and ``audit_logs_crud.record_change``). This
module supplies only the event's update schema (so every editable field is
audited), the venue/track FK→name enrichment, and the entity metadata.

The router calls :func:`record_event_audit` after each event mutation. An audit
failure never breaks the user-facing mutation (best-effort, except deletes which
stage atomically via ``commit=False``).
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlmodel import Session

from app.api.audit_log.actor import AuditActor
from app.api.audit_log.constants import AuditEntityType
from app.api.audit_log.crud import audit_logs_crud
from app.api.audit_log.models import AuditLog
from app.api.audit_log.snapshot import build_snapshot, fields_from_update_schema
from app.api.event_audit.schemas import EventAuditAction

if TYPE_CHECKING:
    from app.api.event.models import Events


def build_event_snapshot(session: Session, event: Events) -> dict[str, Any]:
    """Snapshot every editable event field (from EventUpdate) + readable FK names."""
    from app.api.event.schemas import EventUpdate

    snapshot = build_snapshot(event, fields_from_update_schema(EventUpdate))

    venue_id = getattr(event, "venue_id", None)
    if venue_id is not None:
        from app.api.event_venue.models import EventVenues

        venue = session.get(EventVenues, venue_id)
        snapshot["venue_name"] = venue.title if venue is not None else None
    else:
        snapshot["venue_name"] = None

    track_id = getattr(event, "track_id", None)
    if track_id is not None:
        from app.api.track.models import Tracks

        track = session.get(Tracks, track_id)
        snapshot["track_name"] = track.name if track is not None else None
    else:
        snapshot["track_name"] = None

    return snapshot


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
    """Persist one audit row for an event mutation (entity_type=event).

    Pass ``event_id``/``event_title`` for deletes where ``event`` may be stale.
    commit=False stages atomically with the mutation (deletes); default is
    best-effort after the mutation already committed.
    """
    if snapshot is None and event is not None:
        snapshot = build_event_snapshot(session, event)

    return audit_logs_crud.record_change(
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
        snapshot=snapshot,
        changes=changes,
        commit=commit,
    )
