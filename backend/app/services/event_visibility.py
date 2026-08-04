"""Event opacity chokepoint — single projection point for all event-returning endpoints.

Design reference: Design Decision 1d (observation #1461, Revision 2).

``project_event_for`` is the ONLY place in the codebase where the
EventPublic | EventOpaque | None decision is made. Every event-returning
endpoint MUST route through this function.

Decision order (first match wins):
  1. visibility != PRIVATE -> EventPublic (PUBLIC / UNLISTED unchanged)
  2. is_admin_in_popup -> EventPublic
  3. viewer is event owner -> EventPublic
  4. group_id IS NOT NULL AND group_id IN viewer_group_ids -> EventPublic
  5. group_id IS NULL AND viewer is in invitee_ids -> EventPublic (invitation-based PRIVATE)
  6. Otherwise:
       mode='listing'      -> None     (caller omits event from results)
       mode='availability' -> EventOpaque (venue conflict, no metadata leaked)

Helpers are intentionally NOT fetched here. Callers pre-compute
``viewer_group_ids`` (one query per request via
``group_crud.get_human_group_ids``) and pass ``invitee_ids`` for
listing endpoints that already have invitation data in scope.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Literal

from app.api.event.schemas import EventOpaque, EventPublic, EventVisibility

if TYPE_CHECKING:
    pass


def project_event_for(
    *,
    viewer,
    event,
    viewer_group_ids: set[uuid.UUID],
    is_admin_in_popup: bool,
    mode: Literal["listing", "availability"] = "listing",
    invitee_ids: set[uuid.UUID] | None = None,
) -> EventPublic | EventOpaque | None:
    """Project an event to a viewer returning EventPublic, EventOpaque, or None.

    Args:
        viewer: The viewing user/human. Must have an ``.id`` attribute.
        event: An Events row (or pseudo-row). Must have visibility, group_id,
               owner_id, id, start_time, end_time, venue_id attributes.
        viewer_group_ids: Set of group UUIDs the viewer belongs to for this popup.
                          Pre-computed by the caller — NOT fetched here.
        is_admin_in_popup: True if the viewer is an admin/superadmin for the
                           popup that owns this event.
        mode: 'listing' to omit hidden events (returns None), or 'availability'
              to expose opaque conflict information (returns EventOpaque).
        invitee_ids: Set of human IDs invited to this event. Required for
                     invitation-based PRIVATE events (group_id IS NULL).
                     Pass None or empty set for group-scoped events.

    Returns:
        EventPublic  — full event detail
        EventOpaque  — conflict skeleton (mode='availability' only)
        None         — event should be omitted (mode='listing' only)
    """
    # 1. Non-PRIVATE: always full detail
    if event.visibility != EventVisibility.PRIVATE:
        return EventPublic.model_validate(event)

    # 2. Admin bypass
    if is_admin_in_popup:
        return EventPublic.model_validate(event)

    # 3. Owner bypass
    if event.owner_id == viewer.id:
        return EventPublic.model_validate(event)

    # 4. Group-scoped PRIVATE: membership check
    if event.group_id is not None:
        if event.group_id in viewer_group_ids:
            return EventPublic.model_validate(event)
        # Non-member
        return _opaque_or_none(event, mode)

    # 5. Invitation-based PRIVATE (group_id IS NULL): invitee check
    resolved_invitees: set[uuid.UUID] = invitee_ids or set()
    if viewer.id in resolved_invitees:
        return EventPublic.model_validate(event)

    # 6. Not a member/invitee/owner/admin
    return _opaque_or_none(event, mode)


def _opaque_or_none(
    event, mode: Literal["listing", "availability"]
) -> EventOpaque | None:
    """Return EventOpaque for availability endpoints, None for listing endpoints."""
    if mode == "availability":
        return EventOpaque(
            id=event.id,
            start_time=event.start_time,
            end_time=event.end_time,
            venue_id=event.venue_id,
        )
    return None
