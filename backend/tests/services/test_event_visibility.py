"""Unit tests for project_event_for — opacity chokepoint.

Tests the full truth table of the projection logic:
  - PUBLIC / UNLISTED: always EventPublic
  - PRIVATE + is_admin_in_popup=True: EventPublic
  - PRIVATE + owner: EventPublic
  - PRIVATE + group_id set + viewer in group: EventPublic
  - PRIVATE + group_id set + viewer NOT in group:
      mode='listing' -> None
      mode='availability' -> EventOpaque
  - PRIVATE + group_id IS NULL + viewer is invitee: EventPublic
  - PRIVATE + group_id IS NULL + viewer NOT invitee:
      mode='listing' -> None
      mode='availability' -> EventOpaque

TDD: these tests were written BEFORE event_visibility.py existed.
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

from app.api.event.schemas import EventOpaque, EventPublic, EventVisibility
from app.services.event_visibility import project_event_for


def _make_event(
    *,
    visibility: EventVisibility = EventVisibility.PUBLIC,
    group_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    venue_id: uuid.UUID | None = None,
) -> MagicMock:
    from datetime import UTC, datetime

    event = MagicMock(
        spec=[
            "id",
            "visibility",
            "group_id",
            "owner_id",
            "start_time",
            "end_time",
            "venue_id",
            "title",
            "content",
            "tenant_id",
            "popup_id",
            "meeting_url",
            "host_display_name",
            "max_participant",
            "tags",
            "cover_url",
            "custom_location_name",
            "custom_location_url",
            "track_id",
            "require_approval",
            "kind",
            "status",
            "highlighted",
            "rejection_reason",
            "rrule",
            "recurrence_master_id",
            "recurrence_exdates",
            "ical_sequence",
            "timezone",
            "created_at",
            "updated_at",
            # EventPublic-only (must be explicit None/value, NOT MagicMock)
            "occurrence_id",
            "venue_title",
            "venue_location",
            "venue_image_url",
            "track_title",
            "hidden",
            "my_rsvp_status",
        ]
    )
    event.id = uuid.uuid4()
    event.visibility = visibility
    event.group_id = group_id
    event.owner_id = owner_id or uuid.uuid4()
    event.start_time = datetime(2026, 7, 1, 10, 0, 0, tzinfo=UTC)
    event.end_time = datetime(2026, 7, 1, 11, 0, 0, tzinfo=UTC)
    event.venue_id = venue_id or uuid.uuid4()
    # Full EventPublic fields to allow model_validate
    event.title = "Test Event"
    event.content = None
    event.tenant_id = uuid.uuid4()
    event.popup_id = uuid.uuid4()
    event.meeting_url = None
    event.host_display_name = None
    event.max_participant = None
    event.tags = []
    event.cover_url = None
    event.custom_location_name = None
    event.custom_location_url = None
    event.track_id = None
    event.require_approval = False
    event.kind = None
    event.status = "published"
    event.highlighted = False
    event.rejection_reason = None
    event.rrule = None
    event.recurrence_master_id = None
    event.recurrence_exdates = []
    event.ical_sequence = 0
    event.timezone = "UTC"
    event.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    event.updated_at = datetime(2026, 1, 1, tzinfo=UTC)
    # EventPublic virtual fields — must be None, not MagicMock stubs
    event.occurrence_id = None
    event.venue_title = None
    event.venue_location = None
    event.venue_image_url = None
    event.track_title = None
    event.hidden = False
    event.my_rsvp_status = None
    return event


def _make_viewer(*, human_id: uuid.UUID | None = None) -> MagicMock:
    viewer = MagicMock()
    viewer.id = human_id or uuid.uuid4()
    return viewer


# ---------------------------------------------------------------------------
# PUBLIC and UNLISTED events: always full detail regardless of membership
# ---------------------------------------------------------------------------


class TestPublicUnlistedAlwaysVisible:
    def test_public_event_returns_event_public(self) -> None:
        event = _make_event(visibility=EventVisibility.PUBLIC)
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),
            is_admin_in_popup=False,
            mode="listing",
        )

        assert isinstance(result, EventPublic)
        assert result.id == event.id

    def test_unlisted_event_returns_event_public(self) -> None:
        event = _make_event(visibility=EventVisibility.UNLISTED)
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),
            is_admin_in_popup=False,
            mode="listing",
        )

        assert isinstance(result, EventPublic)
        assert result.id == event.id

    def test_public_event_availability_mode_returns_event_public(self) -> None:
        event = _make_event(visibility=EventVisibility.PUBLIC)
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),
            is_admin_in_popup=False,
            mode="availability",
        )

        assert isinstance(result, EventPublic)


# ---------------------------------------------------------------------------
# PRIVATE events: admin bypass
# ---------------------------------------------------------------------------


class TestAdminBypass:
    def test_admin_sees_private_group_event_as_public(self) -> None:
        group_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=group_id,
        )
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),  # NOT in the group
            is_admin_in_popup=True,
            mode="listing",
        )

        assert isinstance(result, EventPublic)

    def test_admin_sees_private_invitation_event_as_public(self) -> None:
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=None,
        )
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),
            is_admin_in_popup=True,
            mode="listing",
        )

        assert isinstance(result, EventPublic)

    def test_admin_availability_mode_also_sees_full(self) -> None:
        group_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=group_id,
        )
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),
            is_admin_in_popup=True,
            mode="availability",
        )

        assert isinstance(result, EventPublic)


# ---------------------------------------------------------------------------
# PRIVATE events: owner bypass
# ---------------------------------------------------------------------------


class TestOwnerBypass:
    def test_owner_sees_own_private_group_event_as_public(self) -> None:
        owner_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=uuid.uuid4(),
            owner_id=owner_id,
        )
        viewer = _make_viewer(human_id=owner_id)

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),  # owner not in group either
            is_admin_in_popup=False,
            mode="listing",
        )

        assert isinstance(result, EventPublic)

    def test_owner_sees_own_private_invitation_event_as_public(self) -> None:
        owner_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=None,
            owner_id=owner_id,
        )
        viewer = _make_viewer(human_id=owner_id)

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),
            is_admin_in_popup=False,
            mode="availability",
        )

        assert isinstance(result, EventPublic)


# ---------------------------------------------------------------------------
# PRIVATE + group_id set: membership check
# ---------------------------------------------------------------------------


class TestGroupScopedPrivate:
    def test_group_member_sees_full_detail(self) -> None:
        group_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=group_id,
        )
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids={group_id},  # viewer IS a member
            is_admin_in_popup=False,
            mode="listing",
        )

        assert isinstance(result, EventPublic)

    def test_non_member_listing_returns_none(self) -> None:
        group_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=group_id,
        )
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),  # NOT a member
            is_admin_in_popup=False,
            mode="listing",
        )

        assert result is None

    def test_non_member_availability_returns_opaque(self) -> None:
        group_id = uuid.uuid4()
        venue_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=group_id,
            venue_id=venue_id,
        )
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),  # NOT a member
            is_admin_in_popup=False,
            mode="availability",
        )

        assert isinstance(result, EventOpaque)
        assert result.is_opaque is True
        assert result.id == event.id
        assert result.venue_id == venue_id
        # Must NOT leak sensitive fields
        assert not hasattr(result, "title")
        assert not hasattr(result, "description")
        assert not hasattr(result, "meeting_url")
        assert not hasattr(result, "host_display_name")

    def test_member_in_different_group_sees_listing_as_none(self) -> None:
        """Viewer is in group G2 but event is for G1."""
        group_id = uuid.uuid4()
        other_group_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=group_id,
        )
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids={other_group_id},
            is_admin_in_popup=False,
            mode="listing",
        )

        assert result is None

    def test_member_in_multiple_groups_sees_correct_event(self) -> None:
        """Viewer is in multiple groups, including the event's group."""
        group_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=group_id,
        )
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids={uuid.uuid4(), group_id, uuid.uuid4()},
            is_admin_in_popup=False,
            mode="listing",
        )

        assert isinstance(result, EventPublic)


# ---------------------------------------------------------------------------
# PRIVATE + group_id IS NULL: invitation-based PRIVATE (legacy behavior)
# ---------------------------------------------------------------------------


class TestInvitationBasedPrivate:
    def test_invitee_sees_full_detail_listing(self) -> None:
        human_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=None,
        )
        viewer = _make_viewer(human_id=human_id)
        # invitee_ids is passed pre-computed
        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),
            is_admin_in_popup=False,
            mode="listing",
            invitee_ids={human_id},
        )

        assert isinstance(result, EventPublic)

    def test_non_invitee_listing_returns_none(self) -> None:
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=None,
        )
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),
            is_admin_in_popup=False,
            mode="listing",
            invitee_ids=set(),  # empty — not invited
        )

        assert result is None

    def test_non_invitee_availability_returns_opaque(self) -> None:
        """Security fix: non-invitee now sees EventOpaque in availability."""
        venue_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=None,
            venue_id=venue_id,
        )
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),
            is_admin_in_popup=False,
            mode="availability",
            invitee_ids=set(),
        )

        assert isinstance(result, EventOpaque)
        assert result.is_opaque is True
        assert result.venue_id == venue_id

    def test_invitee_availability_sees_full_detail(self) -> None:
        human_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=None,
        )
        viewer = _make_viewer(human_id=human_id)

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),
            is_admin_in_popup=False,
            mode="availability",
            invitee_ids={human_id},
        )

        assert isinstance(result, EventPublic)


# ---------------------------------------------------------------------------
# EventOpaque field contract
# ---------------------------------------------------------------------------


class TestEventOpaqueFieldContract:
    def test_opaque_has_only_required_fields(self) -> None:
        """EventOpaque must only expose id, start_time, end_time, venue_id, is_opaque."""
        group_id = uuid.uuid4()
        venue_id = uuid.uuid4()
        event = _make_event(
            visibility=EventVisibility.PRIVATE,
            group_id=group_id,
            venue_id=venue_id,
        )
        viewer = _make_viewer()

        result = project_event_for(
            viewer=viewer,
            event=event,
            viewer_group_ids=set(),
            is_admin_in_popup=False,
            mode="availability",
        )

        assert isinstance(result, EventOpaque)
        opaque_dict = result.model_dump()
        assert "id" in opaque_dict
        assert "start_time" in opaque_dict
        assert "end_time" in opaque_dict
        assert "venue_id" in opaque_dict
        assert opaque_dict["is_opaque"] is True
        # Must NOT contain sensitive fields
        assert "title" not in opaque_dict
        assert "description" not in opaque_dict
        assert "meeting_url" not in opaque_dict
        assert "host_display_name" not in opaque_dict
        assert "tags" not in opaque_dict
        assert "track_id" not in opaque_dict
