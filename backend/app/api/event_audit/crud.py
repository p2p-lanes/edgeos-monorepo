"""Write path and helpers for the event audit log.

The router calls :func:`record_event_audit` after each event mutation. The
actor is resolved from the request principal via :func:`actor_from_user`
(backoffice) or :func:`actor_from_human` (portal).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from enum import Enum
from typing import TYPE_CHECKING, Any

from loguru import logger
from sqlmodel import Session

from app.api.event_audit.models import EventAuditLog
from app.api.event_audit.schemas import (
    AuditActor,
    EventAuditAction,
    EventAuditActorType,
    EventAuditSource,
)

if TYPE_CHECKING:
    from app.api.event.models import Events
    from app.api.human.schemas import HumanPublic
    from app.api.user.schemas import UserPublic

# Event fields captured in the snapshot and compared for the diff. Kept small
# and stable on purpose: identity + the "request data" the audit log promises
# (date/time, venue, visibility) plus the lifecycle status.
_SNAPSHOT_FIELDS = (
    "title",
    "start_time",
    "end_time",
    "timezone",
    "venue_id",
    "custom_location_name",
    "visibility",
    "status",
)


def _jsonable(value: Any) -> Any:
    """Coerce a value to something JSON/JSONB-serializable and diff-stable."""
    if isinstance(value, Enum):
        # StrEnum / (str, Enum) members → their primitive value ("public")
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def build_event_snapshot(session: Session, event: Events) -> dict[str, Any]:
    """Snapshot the audited fields of ``event``, resolving the venue name.

    Returns a JSON-serializable dict. ``venue_name`` is looked up from
    ``event_venues`` when the event references a venue.
    """
    snapshot: dict[str, Any] = {
        field: _jsonable(getattr(event, field, None)) for field in _SNAPSHOT_FIELDS
    }

    venue_id = getattr(event, "venue_id", None)
    venue_name: str | None = None
    if venue_id is not None:
        from app.api.event_venue.models import EventVenues

        venue = session.get(EventVenues, venue_id)
        venue_name = venue.name if venue is not None else None
    snapshot["venue_name"] = venue_name

    return snapshot


def compute_changes(
    before: dict[str, Any], after: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Diff two snapshots → ``{field: {"old": ..., "new": ...}}``.

    Only fields whose value changed are included. Both inputs are expected to
    already be JSON-serializable (e.g. from :func:`build_event_snapshot`).
    """
    changes: dict[str, dict[str, Any]] = {}
    for key in before.keys() | after.keys():
        old = before.get(key)
        new = after.get(key)
        if old != new:
            changes[key] = {"old": old, "new": new}
    return changes


def actor_from_user(current_user: UserPublic) -> AuditActor:
    """Build an :class:`AuditActor` for a backoffice (staff) user."""
    return AuditActor(
        type=EventAuditActorType.USER,
        source=EventAuditSource.BACKOFFICE,
        id=current_user.id,
        email=getattr(current_user, "email", None),
        name=getattr(current_user, "email", None),
    )


def actor_from_human(current_human: HumanPublic) -> AuditActor:
    """Build an :class:`AuditActor` for a portal (community) human."""
    first = getattr(current_human, "first_name", None) or ""
    last = getattr(current_human, "last_name", None) or ""
    name = f"{first} {last}".strip() or None
    return AuditActor(
        type=EventAuditActorType.HUMAN,
        source=EventAuditSource.PORTAL,
        id=current_human.id,
        email=getattr(current_human, "email", None),
        name=name,
    )


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
) -> EventAuditLog | None:
    """Persist one audit row for an event mutation.

    Best-effort: an audit failure must never break the user-facing mutation
    (which is already committed), so any exception is logged and swallowed.

    Args:
        session: active session (the mutation has typically already committed).
        event: the event being audited. May be a stale/expired instance for
            deletes — pass ``event_id``/``event_title`` explicitly in that case.
        action: the kind of mutation.
        actor: resolved identity + source (portal/backoffice).
        changes: optional precomputed field diff (for updates).
        snapshot: optional precomputed snapshot; when omitted it is built from
            ``event`` via :func:`build_event_snapshot`.
        event_id / event_title: overrides for when ``event`` is unavailable.
    """
    try:
        if snapshot is None:
            snapshot = build_event_snapshot(session, event)

        row = EventAuditLog(
            tenant_id=event.tenant_id,
            popup_id=getattr(event, "popup_id", None),
            event_id=event_id if event_id is not None else event.id,
            event_title=event_title
            if event_title is not None
            else getattr(event, "title", None),
            action=action.value,
            source=actor.source.value,
            actor_type=actor.type.value,
            actor_id=actor.id,
            actor_email=actor.email,
            actor_name=actor.name,
            request_id=_current_request_id(),
            snapshot=snapshot,
            changes=changes or None,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row
    except Exception as exc:  # noqa: BLE001 — audit must never break the request
        session.rollback()
        logger.warning(
            "event audit write failed (action={} event={}): {}",
            action.value,
            event_id if event_id is not None else getattr(event, "id", None),
            exc,
        )
        return None


def _current_request_id() -> str | None:
    """Read the current request id bound by the logging middleware, if any."""
    try:
        from app.core.logging import get_request_id

        return get_request_id()
    except Exception:
        return None
