"""Integration + unit tests for iTIP dispatch around the events lifecycle.

Exercises:
- ``build_event_ics`` content for METHOD=REQUEST and METHOD=CANCEL, including
  SEQUENCE propagation and UTC-formatted DTSTART/DTEND regardless of the
  event's ``timezone`` column (iTIP always stores UTC instants with ``Z``).
- ``gather_event_recipients`` dedup when a human is both invited and an
  active participant, and exclusion of cancelled participants.
- ``calendar_fields_changed`` semantics (which fields bump SEQUENCE).
- End-to-end: bulk invite sends REQUEST, PATCH of a calendar field bumps
  SEQUENCE and re-sends REQUEST to all recipients, PATCH of a non-calendar
  field does nothing, /cancel and DELETE emit CANCEL with SEQUENCE+1.

Email delivery itself is mocked at the ``send_event_itip`` boundary so
bump-and-dispatch logic still runs against the real DB.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import EventInvitations, Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_participant.models import EventParticipants
from app.api.event_participant.schemas import ParticipantStatus
from app.api.event_venue.models import EventVenues
from app.api.event_venue.schemas import VenueBookingMode, VenueStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.services.event_itip import (
    calendar_fields_changed,
    gather_event_recipients,
)
from app.services.ical import build_event_ics

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"iTIP Test {uuid.uuid4().hex[:6]}",
        slug=f"itip-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_event(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    status: EventStatus = EventStatus.PUBLISHED,
    owner_id: uuid.UUID | None = None,
    start: datetime | None = None,
    timezone: str = "UTC",
) -> Events:
    start = start or (datetime.now(UTC) + timedelta(days=7))
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=owner_id or uuid.uuid4(),
        title="iTIP Test Event",
        start_time=start,
        end_time=start + timedelta(hours=1),
        timezone=timezone,
        visibility=EventVisibility.PUBLIC,
        status=status,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _make_human(db: Session, tenant: Tenants, *, email: str | None = None) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=email or f"itip-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Test",
        last_name="Human",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _invite(db: Session, event: Events, human: Humans) -> EventInvitations:
    inv = EventInvitations(
        tenant_id=event.tenant_id,
        event_id=event.id,
        human_id=human.id,
        invited_by=event.owner_id,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv


def _register(
    db: Session,
    event: Events,
    human: Humans,
    *,
    status: ParticipantStatus = ParticipantStatus.REGISTERED,
) -> EventParticipants:
    p = EventParticipants(
        tenant_id=event.tenant_id,
        event_id=event.id,
        profile_id=human.id,
        status=status,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# The router imports `send_event_itip` at module load time as the alias
# `_send_event_itip`, so patching `app.services.event_itip.send_event_itip`
# does NOT intercept the router's direct call inside
# `_send_event_invitation_emails` (bulk invite). We have to patch the
# router-local name too.
#
# `bump_and_dispatch_*` however resolves `send_event_itip` via the service
# module's globals at call time, so the service-level patch is sufficient
# for PATCH/cancel/delete.
_PATCH_SEND_SERVICE = "app.services.event_itip.send_event_itip"
_PATCH_SEND_ROUTER = "app.api.event.router._send_event_itip"


def _patch_send_everywhere(mock: AsyncMock):
    """Context manager that silences both call sites in one `with`."""
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(patch(_PATCH_SEND_SERVICE, new=mock))
    stack.enter_context(patch(_PATCH_SEND_ROUTER, new=mock))
    return stack


# ---------------------------------------------------------------------------
# Unit: build_event_ics
# ---------------------------------------------------------------------------


class TestBuildEventIcs:
    """`build_event_ics` covers the wire-level contract with mail clients."""

    def _minimal_event(
        self,
        *,
        start: datetime,
        end: datetime,
        ical_sequence: int = 0,
        timezone: str = "UTC",
        title: str = "Launch Party",
        content: str = "See you there",
    ) -> Events:
        # Not persisted — build_event_ics only reads attributes.
        return Events(
            tenant_id=uuid.uuid4(),
            popup_id=uuid.uuid4(),
            owner_id=uuid.uuid4(),
            title=title,
            content=content,
            start_time=start,
            end_time=end,
            timezone=timezone,
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.PUBLISHED,
            ical_sequence=ical_sequence,
        )

    def test_request_contains_core_headers_and_sequence(self) -> None:
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        end = start + timedelta(hours=1)
        event = self._minimal_event(start=start, end=end, ical_sequence=3)

        ics = build_event_ics(
            event,
            recipient_email="alice@example.com",
            recipient_name="Alice",
            organizer_email="org@example.com",
            organizer_name="Organizer",
            method="REQUEST",
            sequence=3,
        )

        assert "METHOD:REQUEST" in ics
        assert f"UID:{event.id}@edgeos" in ics
        assert "DTSTART:20260505T140000Z" in ics
        assert "DTEND:20260505T150000Z" in ics
        assert "SEQUENCE:3" in ics
        assert "SUMMARY:Launch Party" in ics
        assert "STATUS:CONFIRMED" in ics
        assert "ATTENDEE" in ics
        assert "mailto:alice@example.com" in ics
        assert "ORGANIZER" in ics
        assert "mailto:org@example.com" in ics

    def test_cancel_flips_method_and_status(self) -> None:
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        event = self._minimal_event(
            start=start, end=start + timedelta(hours=1), ical_sequence=5
        )

        ics = build_event_ics(
            event,
            recipient_email="alice@example.com",
            method="CANCEL",
            sequence=5,
        )

        assert "METHOD:CANCEL" in ics
        assert "STATUS:CANCELLED" in ics
        assert "SEQUENCE:5" in ics

    def test_non_utc_event_still_emits_utc_instants(self) -> None:
        """iTIP always uses UTC with 'Z' suffix even when the popup is local."""
        buenos_aires = ZoneInfo("America/Argentina/Buenos_Aires")
        start_local = datetime(2026, 5, 5, 11, 0, tzinfo=buenos_aires)
        event = self._minimal_event(
            start=start_local,
            end=start_local + timedelta(hours=2),
            timezone="America/Argentina/Buenos_Aires",
        )

        ics = build_event_ics(event, recipient_email="alice@example.com")

        # 11:00 AR (UTC-3) → 14:00 UTC.
        assert "DTSTART:20260505T140000Z" in ics
        assert "DTEND:20260505T160000Z" in ics

    def test_escapes_commas_and_semicolons_in_summary(self) -> None:
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        event = self._minimal_event(
            start=start,
            end=start + timedelta(hours=1),
            title="Party, with; surprises",
        )

        ics = build_event_ics(event, recipient_email="alice@example.com")

        assert r"SUMMARY:Party\, with\; surprises" in ics

    def test_uid_stable_across_invite_and_update(self) -> None:
        """For non-recurring events the UID must not drift between the
        first REQUEST (invite) and a later REQUEST with bumped SEQUENCE
        (update) — otherwise Gmail/Apple/Outlook can't correlate the two
        and the user ends up with a duplicate calendar entry instead of
        a patched one.
        """
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        event = self._minimal_event(start=start, end=start + timedelta(hours=1))

        invite = build_event_ics(
            event, recipient_email="alice@example.com", method="REQUEST", sequence=0
        )
        update = build_event_ics(
            event, recipient_email="alice@example.com", method="REQUEST", sequence=1
        )

        assert f"UID:{event.id}@edgeos" in invite
        assert f"UID:{event.id}@edgeos" in update
        # And no RECURRENCE-ID for one-offs.
        assert "RECURRENCE-ID:" not in invite
        assert "RECURRENCE-ID:" not in update

    def test_recurring_rsvp_uses_recurrence_id(self) -> None:
        """When a participant RSVPs to one instance of a recurring series,
        the per-recipient ICS must keep the master UID and add a
        RECURRENCE-ID line targeting the chosen instance — that's the
        RFC 5546 mechanism every major client uses to bind the entry to
        the master series so future REQUESTs patch it in place.
        """
        master_start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        event = self._minimal_event(
            start=master_start, end=master_start + timedelta(hours=1)
        )
        occurrence = master_start + timedelta(weeks=2)

        ics = build_event_ics(
            event,
            recipient_email="alice@example.com",
            method="REQUEST",
            occurrence_start=occurrence,
        )

        assert f"UID:{event.id}@edgeos" in ics
        assert f"_{occurrence.strftime('%Y%m%dT%H%M%SZ')}@edgeos" not in ics
        assert f"RECURRENCE-ID:{occurrence.strftime('%Y%m%dT%H%M%SZ')}" in ics
        # DTSTART/DTEND shifted to the occurrence + duration.
        assert "DTSTART:20260519T140000Z" in ics
        assert "DTEND:20260519T150000Z" in ics

    def test_update_after_recurring_rsvp_keeps_uid(self) -> None:
        """Simulate the RSVP → organiser-update pipeline: the update
        REQUEST emitted to a per-occurrence RSVPer must carry the same
        master UID and the same RECURRENCE-ID as the original invite,
        with SEQUENCE bumped. This is the contract that makes Google
        Calendar update the existing entry instead of creating a sibling.
        """
        master_start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        event = self._minimal_event(
            start=master_start, end=master_start + timedelta(hours=1)
        )
        occurrence = master_start + timedelta(weeks=2)

        invite = build_event_ics(
            event,
            recipient_email="alice@example.com",
            method="REQUEST",
            sequence=0,
            occurrence_start=occurrence,
        )
        # Organiser shifts the master start later — service bumps SEQUENCE
        # and re-sends. Per-recipient ICS is generated again with the same
        # occurrence_start the user RSVPd to.
        event.start_time = master_start + timedelta(hours=3)
        event.end_time = event.start_time + timedelta(hours=1)
        update = build_event_ics(
            event,
            recipient_email="alice@example.com",
            method="REQUEST",
            sequence=1,
            occurrence_start=occurrence,
        )

        assert f"UID:{event.id}@edgeos" in invite
        assert f"UID:{event.id}@edgeos" in update
        assert f"RECURRENCE-ID:{occurrence.strftime('%Y%m%dT%H%M%SZ')}" in invite
        assert f"RECURRENCE-ID:{occurrence.strftime('%Y%m%dT%H%M%SZ')}" in update
        assert "SEQUENCE:0" in invite
        assert "SEQUENCE:1" in update


# ---------------------------------------------------------------------------
# Unit: gather_event_recipients
# ---------------------------------------------------------------------------


class TestGatherEventRecipients:
    """Dedup rules across EventInvitations and EventParticipants."""

    def test_dedup_between_invitation_and_active_participant(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a, email="dedup@test.com")

        _invite(db, event, human)
        _register(db, event, human)

        recipients = gather_event_recipients(db, event)

        assert len(recipients) == 1
        assert recipients[0]["email"] == "dedup@test.com"
        assert recipients[0]["human_id"] == human.id

    def test_cancelled_participants_excluded(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        cancelled = _make_human(db, tenant_a)

        _register(db, event, cancelled, status=ParticipantStatus.CANCELLED)

        recipients = gather_event_recipients(db, event)

        assert cancelled.id not in {r["human_id"] for r in recipients}

    def test_invitation_plus_additional_participant_both_returned(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        invited_only = _make_human(db, tenant_a)
        participant_only = _make_human(db, tenant_a)

        _invite(db, event, invited_only)
        _register(db, event, participant_only)

        recipients = gather_event_recipients(db, event)
        returned = {r["human_id"] for r in recipients}
        assert returned == {invited_only.id, participant_only.id}


# ---------------------------------------------------------------------------
# Unit: calendar_fields_changed
# ---------------------------------------------------------------------------


class TestCalendarFieldsChanged:
    """Which field diffs should cause a SEQUENCE bump."""

    def _event(self, **overrides) -> Events:
        defaults = {
            "tenant_id": uuid.uuid4(),
            "popup_id": uuid.uuid4(),
            "owner_id": uuid.uuid4(),
            "title": "Original",
            "start_time": datetime(2026, 5, 5, 14, 0, tzinfo=UTC),
            "end_time": datetime(2026, 5, 5, 15, 0, tzinfo=UTC),
            "timezone": "UTC",
            "visibility": EventVisibility.PUBLIC,
            "status": EventStatus.PUBLISHED,
            "venue_id": None,
        }
        defaults.update(overrides)
        return Events(**defaults)

    def _snapshot(self, event: Events) -> dict:
        return {
            "title": event.title,
            "start_time": event.start_time,
            "end_time": event.end_time,
            "venue_id": event.venue_id,
        }

    def test_title_change_bumps(self) -> None:
        event = self._event()
        before = self._snapshot(event)
        event.title = "Renamed"
        assert calendar_fields_changed(before, event) is True

    def test_start_time_change_bumps(self) -> None:
        event = self._event()
        before = self._snapshot(event)
        event.start_time = event.start_time + timedelta(hours=1)
        assert calendar_fields_changed(before, event) is True

    def test_venue_change_bumps(self) -> None:
        event = self._event()
        before = self._snapshot(event)
        event.venue_id = uuid.uuid4()
        assert calendar_fields_changed(before, event) is True

    def test_description_change_does_not_bump(self) -> None:
        event = self._event()
        before = self._snapshot(event)
        event.content = "new description"
        assert calendar_fields_changed(before, event) is False

    def test_visibility_change_does_not_bump(self) -> None:
        event = self._event()
        before = self._snapshot(event)
        event.visibility = EventVisibility.UNLISTED
        assert calendar_fields_changed(before, event) is False


# ---------------------------------------------------------------------------
# Integration: bulk invite / PATCH / cancel / DELETE
# ---------------------------------------------------------------------------


def _make_venue(db: Session, tenant: Tenants, popup: Popups) -> EventVenues:
    venue = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title="iTIP Venue",
        status=VenueStatus.ACTIVE,
        booking_mode=VenueBookingMode.FREE,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


class TestBulkInviteDispatch:
    """POST /events/{id}/invitations."""

    def test_bulk_invite_dispatches_request_to_each_invitee(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        alice = _make_human(db, tenant_a, email="alice@test.com")
        bob = _make_human(db, tenant_a, email="bob@test.com")

        send_mock = AsyncMock(return_value=None)
        with _patch_send_everywhere(send_mock):
            resp = client.post(
                f"/api/v1/events/{event.id}/invitations",
                headers=_auth(admin_token_tenant_a),
                json={"emails": [alice.email, bob.email]},
            )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert len(body["invited"]) == 2

        # Exactly one send_event_itip call for the two newly-invited humans.
        assert send_mock.await_count == 1
        _args, kwargs = send_mock.await_args
        positional = send_mock.await_args.args
        recipients = positional[2] if len(positional) > 2 else kwargs["recipients"]
        emails = {r["email"] for r in recipients}
        assert emails == {"alice@test.com", "bob@test.com"}
        assert kwargs["method"] == "REQUEST"

    def test_duplicate_invite_not_resent(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        alice = _make_human(db, tenant_a, email="alice-dup@test.com")

        send_mock = AsyncMock(return_value=None)
        with _patch_send_everywhere(send_mock):
            first = client.post(
                f"/api/v1/events/{event.id}/invitations",
                headers=_auth(admin_token_tenant_a),
                json={"emails": [alice.email]},
            )
            assert first.status_code == 201
            second = client.post(
                f"/api/v1/events/{event.id}/invitations",
                headers=_auth(admin_token_tenant_a),
                json={"emails": [alice.email]},
            )

        assert second.status_code == 201, second.text
        body = second.json()
        assert body["invited"] == []
        assert body["skipped_existing"] == [alice.email]
        # The second invite is skipped → send_event_itip still gets called
        # but with an empty recipient list (a no-op we accept).
        second_call_recipients = send_mock.await_args_list[1].args[2]
        assert second_call_recipients == []


class TestPatchBumpsSequenceAndDispatches:
    """PATCH /events/{id} → SEQUENCE bump + REQUEST fan-out."""

    def test_calendar_field_patch_bumps_and_dispatches(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        _invite(db, event, human)
        before_sequence = event.ical_sequence

        send_mock = AsyncMock(return_value=None)
        with _patch_send_everywhere(send_mock):
            resp = client.patch(
                f"/api/v1/events/{event.id}",
                headers=_auth(admin_token_tenant_a),
                json={"title": "New Title"},
            )

        assert resp.status_code == 200, resp.text
        db.expire_all()
        refreshed = db.get(Events, event.id)
        assert refreshed.ical_sequence == before_sequence + 1
        assert refreshed.title == "New Title"
        assert send_mock.await_count == 1
        assert send_mock.await_args.kwargs["method"] == "REQUEST"
        recipients = send_mock.await_args.args[2]
        assert {r["human_id"] for r in recipients} == {human.id}

    def test_non_calendar_patch_does_not_bump(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        _invite(db, event, _make_human(db, tenant_a))
        before_sequence = event.ical_sequence

        send_mock = AsyncMock(return_value=None)
        with _patch_send_everywhere(send_mock):
            resp = client.patch(
                f"/api/v1/events/{event.id}",
                headers=_auth(admin_token_tenant_a),
                json={"content": "Completely new description"},
            )

        assert resp.status_code == 200, resp.text
        db.expire_all()
        refreshed = db.get(Events, event.id)
        assert refreshed.ical_sequence == before_sequence
        assert refreshed.content == "Completely new description"
        assert send_mock.await_count == 0

    def test_patch_with_two_recipients_fans_out_once(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        invited = _make_human(db, tenant_a, email="invited@test.com")
        rsvped = _make_human(db, tenant_a, email="rsvped@test.com")
        _invite(db, event, invited)
        _register(db, event, rsvped)

        send_mock = AsyncMock(return_value=None)
        with _patch_send_everywhere(send_mock):
            resp = client.patch(
                f"/api/v1/events/{event.id}",
                headers=_auth(admin_token_tenant_a),
                json={
                    "start_time": (event.start_time + timedelta(hours=2)).isoformat()
                },
            )

        assert resp.status_code == 200, resp.text
        assert send_mock.await_count == 1
        recipients = send_mock.await_args.args[2]
        assert {r["email"] for r in recipients} == {
            "invited@test.com",
            "rsvped@test.com",
        }


class TestCancelAndDeleteDispatchCancel:
    """/cancel endpoint and DELETE both emit iTIP CANCEL with SEQUENCE+1."""

    def test_cancel_endpoint_bumps_and_sends_cancel(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        _invite(db, event, _make_human(db, tenant_a))
        before_sequence = event.ical_sequence

        send_mock = AsyncMock(return_value=None)
        with _patch_send_everywhere(send_mock):
            resp = client.post(
                f"/api/v1/events/{event.id}/cancel",
                headers=_auth(admin_token_tenant_a),
            )

        assert resp.status_code == 200, resp.text
        db.expire_all()
        refreshed = db.get(Events, event.id)
        assert refreshed.status == EventStatus.CANCELLED
        assert refreshed.ical_sequence == before_sequence + 1
        assert send_mock.await_count == 1
        assert send_mock.await_args.kwargs["method"] == "CANCEL"

    def test_double_cancel_returns_400(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, status=EventStatus.CANCELLED)

        with _patch_send_everywhere(AsyncMock(return_value=None)):
            resp = client.post(
                f"/api/v1/events/{event.id}/cancel",
                headers=_auth(admin_token_tenant_a),
            )

        assert resp.status_code == 400, resp.text

    def test_delete_sends_cancel_before_dropping_row(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        _invite(db, event, human)
        event_id = event.id
        before_sequence = event.ical_sequence

        send_mock = AsyncMock(return_value=None)
        with _patch_send_everywhere(send_mock):
            resp = client.delete(
                f"/api/v1/events/{event_id}",
                headers=_auth(admin_token_tenant_a),
            )

        assert resp.status_code == 204, resp.text

        # CANCEL fired with SEQUENCE bumped. Snapshot of the event the mock
        # received still had the old id.
        assert send_mock.await_count == 1
        kwargs = send_mock.await_args.kwargs
        assert kwargs["method"] == "CANCEL"
        sent_event = send_mock.await_args.args[1]
        assert sent_event.id == event_id
        assert sent_event.ical_sequence == before_sequence + 1

        # Row actually deleted.
        db.expire_all()
        assert db.get(Events, event_id) is None


# ---------------------------------------------------------------------------
# Integration: recurrence-, detach-, skip-, approve- triggered iTIP
# ---------------------------------------------------------------------------


class TestRecurrenceMutationsDispatch:
    """The plan's missing endpoints all need to fan out iTIP messages so
    a user who RSVPd before the change still gets an updated calendar
    entry. Each test patches the iTIP send boundary and asserts a single
    call with the right METHOD."""

    def test_set_recurrence_dispatches_request(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        _invite(db, event, _make_human(db, tenant_a))

        send_mock = AsyncMock(return_value=None)
        with _patch_send_everywhere(send_mock):
            resp = client.patch(
                f"/api/v1/events/{event.id}/recurrence",
                headers=_auth(admin_token_tenant_a),
                json={
                    "recurrence": {
                        "freq": "WEEKLY",
                        "interval": 1,
                        "count": 4,
                    }
                },
            )

        assert resp.status_code == 200, resp.text
        assert send_mock.await_count == 1
        assert send_mock.await_args.kwargs["method"] == "REQUEST"

    def test_clearing_recurrence_to_same_value_does_not_dispatch(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        # Event starts with no rrule. Clearing it again is a no-op → no
        # iTIP fan-out so users aren't spammed.
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        _invite(db, event, _make_human(db, tenant_a))

        send_mock = AsyncMock(return_value=None)
        with _patch_send_everywhere(send_mock):
            resp = client.patch(
                f"/api/v1/events/{event.id}/recurrence",
                headers=_auth(admin_token_tenant_a),
                json={"recurrence": None},
            )

        assert resp.status_code == 200, resp.text
        assert send_mock.await_count == 0

    def test_delete_occurrence_dispatches_per_occurrence_cancel(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        # Set up a recurring weekly series and one RSVPer for a specific
        # instance.
        start = datetime(2026, 5, 5, 14, 0, tzinfo=UTC)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=uuid.uuid4(),
            title="Weekly meetup",
            start_time=start,
            end_time=start + timedelta(hours=1),
            timezone="UTC",
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.PUBLISHED,
            rrule="FREQ=WEEKLY;COUNT=4",
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        rsvper = _make_human(db, tenant_a, email="rsvper@test.com")
        # Participant for the second occurrence.
        target_occurrence = start + timedelta(weeks=1)
        p = EventParticipants(
            tenant_id=tenant_a.id,
            event_id=event.id,
            profile_id=rsvper.id,
            occurrence_start=target_occurrence,
            status=ParticipantStatus.REGISTERED,
        )
        db.add(p)
        db.commit()

        send_mock = AsyncMock(return_value=None)
        with _patch_send_everywhere(send_mock):
            resp = client.request(
                "DELETE",
                f"/api/v1/events/{event.id}/occurrence",
                headers=_auth(admin_token_tenant_a),
                json={"occurrence_start": target_occurrence.isoformat()},
            )

        assert resp.status_code == 204, resp.text
        assert send_mock.await_count == 1
        kwargs = send_mock.await_args.kwargs
        assert kwargs["method"] == "CANCEL"
        # The per-occurrence dispatch is keyed on the same occurrence the
        # user RSVPd to, and only that user is targeted.
        assert kwargs["occurrence_start"] == target_occurrence
        recipients = send_mock.await_args.args[2]
        assert {r["email"] for r in recipients} == {"rsvper@test.com"}

    def test_approve_dispatches_request_to_invitees(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        # Pending-approval event with one invitation already on it (the
        # most common shape: org member created the event for review).
        event = _make_event(db, tenant_a, popup, status=EventStatus.PENDING_APPROVAL)
        _invite(db, event, _make_human(db, tenant_a, email="inv@test.com"))

        send_mock = AsyncMock(return_value=None)
        with _patch_send_everywhere(send_mock):
            resp = client.post(
                f"/api/v1/events/{event.id}/approve",
                headers=_auth(admin_token_tenant_a),
                json={"reason": "looks good"},
            )

        assert resp.status_code == 200, resp.text
        # _send_event_approval_email is best-effort and silenced when
        # SMTP isn't configured, so we assert only the iTIP fan-out.
        assert send_mock.await_count >= 1
        kwargs = send_mock.await_args_list[-1].kwargs
        assert kwargs["method"] == "REQUEST"
        recipients = send_mock.await_args_list[-1].args[2]
        assert "inv@test.com" in {r["email"] for r in recipients}
