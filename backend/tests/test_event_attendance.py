"""Attendance modes and the organizer's roll call (SIM-106).

Builds on the QR check-in (SIM-103, tests/test_event_qr_check_in.py).

Covers:
- Modes: new events start in ``none``; the QR endpoint refuses in ``none``
  and ``host_rollcall`` even with a copied URL; the QR link is withheld
  outside ``self_checkin``; there is no way back to ``none`` after the first
  check-in; switching between the other two keeps every record.
- Permissions: only the owner, assigned host and collaborators (portal) and
  operators (backoffice) can read the roll call, search by email, mark,
  void or change the mode. ``host_display_name`` grants nothing.
- Walk-ins: marked only when eligible and a seat is free; existing RSVPs
  never take a second seat; marking twice never duplicates.
- The shared time window for marks and voids.
- Voids keep the history (actor, time, method, reason) and free a walk-in's
  seat; a later mark adds to the history instead of replacing it.
- Recurring series: every mark is scoped to one occurrence.
- A manual walk-in and a QR scan racing for the last seat.
"""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.event.models import EventInvitations, Events
from app.api.event.schemas import AttendanceMode, EventVisibility
from app.api.event_participant.check_in import perform_check_in
from app.api.event_participant.models import EventCheckIns, EventParticipants
from app.api.event_participant.schemas import CheckInMethod, ParticipantStatus
from app.api.human.models import Humans
from app.api.tenant.models import Tenants
from tests.test_event_qr_check_in import (
    _check_in,
    _code,
    _give_ticket,
    _headers,
    _make_event,
    _make_human,
    _make_popup,
    _register,
    _rows,
)

ROSTER_URL = "/api/v1/event-participants/portal/attendance/{event_id}"
LOOKUP_URL = "/api/v1/event-participants/portal/attendance/{event_id}/lookup"
MARK_URL = "/api/v1/event-participants/portal/attendance/{event_id}/check-in"
VOID_URL = "/api/v1/event-participants/portal/attendance/{event_id}/void"
MODE_URL = "/api/v1/events/portal/events/{event_id}/attendance-mode"
LINK_URL = "/api/v1/events/portal/events/{event_id}/check-in-link"

ADMIN_ROSTER_URL = "/api/v1/event-participants/attendance/{event_id}"
ADMIN_LOOKUP_URL = "/api/v1/event-participants/attendance/{event_id}/lookup"
ADMIN_MARK_URL = "/api/v1/event-participants/attendance/{event_id}/check-in"
ADMIN_VOID_URL = "/api/v1/event-participants/attendance/{event_id}/void"
ADMIN_MODE_URL = "/api/v1/events/{event_id}/attendance-mode"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _setup(
    db: Session,
    tenant: Tenants,
    *,
    mode: AttendanceMode = AttendanceMode.HOST_ROLLCALL,
    **event_kwargs,
):
    """A popup, its organizer (the event owner) and an event in ``mode``."""
    popup = _make_popup(db, tenant)
    owner = _make_human(db, tenant)
    event = _make_event(
        db, tenant, popup, owner_id=owner.id, attendance_mode=mode, **event_kwargs
    )
    return popup, owner, event


def _attendee(db: Session, tenant: Tenants, popup, *, ticket: bool = True) -> Humans:
    human = _make_human(db, tenant)
    if ticket:
        _give_ticket(db, tenant, popup, human)
    return human


def _mark(client, manager, event, person, **extra):
    return client.post(
        MARK_URL.format(event_id=event.id),
        headers=_headers(manager),
        json={"profile_id": str(person.id), **extra},
    )


def _void(client, manager, event, person, reason="Scanned by mistake", **extra):
    return client.post(
        VOID_URL.format(event_id=event.id),
        headers=_headers(manager),
        json={"profile_id": str(person.id), "reason": reason, **extra},
    )


def _history(db: Session, event_id: uuid.UUID, profile_id: uuid.UUID):
    db.expire_all()
    return list(
        db.exec(
            select(EventCheckIns)
            .where(EventCheckIns.event_id == event_id)
            .where(EventCheckIns.profile_id == profile_id)
            .order_by(EventCheckIns.checked_in_at)
        ).all()
    )


def _status(db: Session, event_id: uuid.UUID, profile_id: uuid.UUID):
    rows = _rows(db, event_id, profile_id)
    assert len(rows) <= 1
    return rows[0].status if rows else None


def _shift_event(db: Session, event: Events, delta: timedelta) -> None:
    """Move an event in time, to step outside the window after a mark."""
    db.refresh(event)
    event.start_time = event.start_time + delta
    event.end_time = event.end_time + delta
    db.add(event)
    db.commit()


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------


class TestModes:
    def test_new_events_start_in_none(self, db: Session, tenant_a: Tenants) -> None:
        popup = _make_popup(db, tenant_a)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=uuid.uuid4(),
            title="Defaults",
            start_time=datetime.now(UTC),
            end_time=datetime.now(UTC) + timedelta(hours=1),
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        assert event.attendance_mode == AttendanceMode.NONE

    @pytest.mark.parametrize(
        "mode", [AttendanceMode.NONE, AttendanceMode.HOST_ROLLCALL]
    )
    def test_qr_refused_outside_self_checkin_even_with_the_url(
        self, client: TestClient, db: Session, tenant_a: Tenants, mode
    ) -> None:
        popup, _, event = _setup(db, tenant_a, mode=mode)
        human = _attendee(db, tenant_a, popup)

        resp = _check_in(client, human, event)

        assert resp.status_code == 403, resp.text
        assert _code(resp) == "qr_check_in_disabled"
        assert _rows(db, event.id, human.id) == []

    def test_qr_link_withheld_outside_self_checkin(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        _, owner, event = _setup(db, tenant_a, mode=AttendanceMode.HOST_ROLLCALL)

        resp = client.get(LINK_URL.format(event_id=event.id), headers=_headers(owner))

        assert resp.status_code == 409, resp.text
        assert _code(resp) == "qr_check_in_disabled"

    @pytest.mark.parametrize("role", ["owner", "host", "collaborator"])
    def test_managers_can_change_the_mode(
        self, client: TestClient, db: Session, tenant_a: Tenants, role: str
    ) -> None:
        popup = _make_popup(db, tenant_a)
        manager = _make_human(db, tenant_a)
        kwargs = {
            "owner": {"owner_id": manager.id},
            "host": {"host_id": manager.id},
            "collaborator": {"collaborator_ids": [manager.id]},
        }[role]
        event = _make_event(
            db, tenant_a, popup, attendance_mode=AttendanceMode.NONE, **kwargs
        )

        resp = client.put(
            MODE_URL.format(event_id=event.id),
            headers=_headers(manager),
            json={"attendance_mode": "host_rollcall"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["attendance_mode"] == "host_rollcall"

    def test_attendee_and_display_name_host_cannot_change_the_mode(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        attendee = _attendee(db, tenant_a, popup)
        # The label matches the attendee's name: it still grants nothing.
        event = _make_event(
            db,
            tenant_a,
            popup,
            host_display_name=f"{attendee.first_name} {attendee.last_name}",
            attendance_mode=AttendanceMode.NONE,
        )

        resp = client.put(
            MODE_URL.format(event_id=event.id),
            headers=_headers(attendee),
            json={"attendance_mode": "self_checkin"},
        )

        assert resp.status_code == 403, resp.text
        db.refresh(event)
        assert event.attendance_mode == AttendanceMode.NONE

    def test_no_way_back_to_none_after_a_check_in_even_if_voided(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a)
        human = _attendee(db, tenant_a, popup)
        assert _mark(client, owner, event, human).status_code == 200
        assert _void(client, owner, event, human).status_code == 200

        resp = client.put(
            MODE_URL.format(event_id=event.id),
            headers=_headers(owner),
            json={"attendance_mode": "none"},
        )

        assert resp.status_code == 409, resp.text
        assert _code(resp) == "attendance_mode_locked"
        db.refresh(event)
        assert event.attendance_mode == AttendanceMode.HOST_ROLLCALL

    def test_none_allowed_while_nobody_checked_in(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        _, owner, event = _setup(db, tenant_a, mode=AttendanceMode.SELF_CHECKIN)

        resp = client.put(
            MODE_URL.format(event_id=event.id),
            headers=_headers(owner),
            json={"attendance_mode": "none"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["attendance_mode"] == "none"

    def test_switching_modes_keeps_attendance(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a, mode=AttendanceMode.SELF_CHECKIN)
        scanner = _attendee(db, tenant_a, popup)
        marked = _attendee(db, tenant_a, popup)
        assert _check_in(client, scanner, event).status_code == 200
        assert _mark(client, owner, event, marked).status_code == 200

        for mode in ("host_rollcall", "self_checkin", "host_rollcall"):
            resp = client.put(
                MODE_URL.format(event_id=event.id),
                headers=_headers(owner),
                json={"attendance_mode": mode},
            )
            assert resp.status_code == 200, resp.text

        roster = client.get(
            ROSTER_URL.format(event_id=event.id), headers=_headers(owner)
        ).json()
        assert roster["checked_in_count"] == 2
        methods = {
            e["profile_id"]: e["history"][0]["method"] for e in roster["entries"]
        }
        assert methods == {str(scanner.id): "qr", str(marked.id): "manual"}

    def test_self_checkin_shares_attendance_between_qr_and_roll_call(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a, mode=AttendanceMode.SELF_CHECKIN)
        human = _attendee(db, tenant_a, popup)
        assert _check_in(client, human, event).status_code == 200

        resp = _mark(client, owner, event, human)

        assert resp.status_code == 200, resp.text
        assert resp.json()["already_checked_in"] is True
        assert len(_history(db, event.id, human.id)) == 1

    def test_backoffice_can_change_the_mode(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        _, _, event = _setup(db, tenant_a, mode=AttendanceMode.NONE)

        resp = client.put(
            ADMIN_MODE_URL.format(event_id=event.id),
            headers=_admin(admin_token_tenant_a),
            json={"attendance_mode": "self_checkin"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["attendance_mode"] == "self_checkin"


# ---------------------------------------------------------------------------
# Roll call: permissions and contents
# ---------------------------------------------------------------------------


class TestRoster:
    @pytest.mark.parametrize("role", ["owner", "host", "collaborator"])
    def test_managers_see_the_roll_call(
        self, client: TestClient, db: Session, tenant_a: Tenants, role: str
    ) -> None:
        popup = _make_popup(db, tenant_a)
        manager = _make_human(db, tenant_a)
        kwargs = {
            "owner": {"owner_id": manager.id},
            "host": {"host_id": manager.id},
            "collaborator": {"collaborator_ids": [manager.id]},
        }[role]
        event = _make_event(
            db, tenant_a, popup, attendance_mode=AttendanceMode.HOST_ROLLCALL, **kwargs
        )
        rsvp = _attendee(db, tenant_a, popup)
        assert _register(client, rsvp, event).status_code == 200

        resp = client.get(
            ROSTER_URL.format(event_id=event.id), headers=_headers(manager)
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [e["profile_id"] for e in body["entries"]] == [str(rsvp.id)]
        assert body["entries"][0]["email"] == rsvp.email
        assert body["entries"][0]["status"] == "registered"
        assert body["seats_taken"] == 1
        assert body["checked_in_count"] == 0
        assert body["window"]["is_open"] is True

    def test_attendee_cannot_read_search_mark_or_void(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a)
        attendee = _attendee(db, tenant_a, popup)
        other = _attendee(db, tenant_a, popup)
        assert _mark(client, owner, event, other).status_code == 200

        roster = client.get(
            ROSTER_URL.format(event_id=event.id), headers=_headers(attendee)
        )
        lookup = client.get(
            LOOKUP_URL.format(event_id=event.id),
            headers=_headers(attendee),
            params={"email": other.email},
        )
        mark = _mark(client, attendee, event, attendee)
        void = _void(client, attendee, event, other)

        for resp in (roster, lookup, mark, void):
            assert resp.status_code == 403, resp.text
            assert _code(resp) == "not_event_manager"
        assert _status(db, event.id, other.id) == ParticipantStatus.CHECKED_IN
        assert _rows(db, event.id, attendee.id) == []

    def test_display_name_host_is_not_a_manager(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        human = _attendee(db, tenant_a, popup)
        event = _make_event(
            db,
            tenant_a,
            popup,
            host_display_name="Scan Ner",
            attendance_mode=AttendanceMode.HOST_ROLLCALL,
        )

        resp = client.get(ROSTER_URL.format(event_id=event.id), headers=_headers(human))

        assert resp.status_code == 403, resp.text

    def test_lookup_by_exact_email(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a)
        walk_in = _attendee(db, tenant_a, popup)

        resp = client.get(
            LOOKUP_URL.format(event_id=event.id),
            headers=_headers(owner),
            params={"email": f"  {walk_in.email.upper()} "},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["profile_id"] == str(walk_in.id)
        assert resp.json()["status"] is None

    def test_lookup_hides_people_who_cannot_attend(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """No ticket and no account answer the same, so nothing leaks."""
        popup, owner, event = _setup(db, tenant_a)
        no_ticket = _attendee(db, tenant_a, popup, ticket=False)

        for email in (no_ticket.email, "nobody-here@test.com", no_ticket.email[:-3]):
            resp = client.get(
                LOOKUP_URL.format(event_id=event.id),
                headers=_headers(owner),
                params={"email": email},
            )
            assert resp.status_code == 404, resp.text
            assert _code(resp) == "attendee_not_found"


# ---------------------------------------------------------------------------
# Manual marks
# ---------------------------------------------------------------------------


class TestManualCheckIn:
    def test_host_rollcall_marks_an_rsvp_without_any_qr(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a)
        human = _attendee(db, tenant_a, popup)
        assert _register(client, human, event).status_code == 200

        resp = _mark(client, owner, event, human)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["created"] is False
        assert body["entry"]["status"] == "checked_in"
        record = body["entry"]["history"][0]
        assert record["method"] == "manual"
        assert record["had_rsvp"] is True
        assert record["checked_in_by"]["kind"] == "human"
        assert record["checked_in_by"]["id"] == str(owner.id)
        assert _status(db, event.id, human.id) == ParticipantStatus.CHECKED_IN

    def test_none_mode_takes_no_attendance(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a, mode=AttendanceMode.NONE)
        human = _attendee(db, tenant_a, popup)

        resp = _mark(client, owner, event, human)

        assert resp.status_code == 403, resp.text
        assert _code(resp) == "attendance_disabled"
        assert _rows(db, event.id, human.id) == []

    def test_walk_in_without_ticket_is_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a)
        human = _attendee(db, tenant_a, popup, ticket=False)

        resp = _mark(client, owner, event, human)

        assert resp.status_code == 403, resp.text
        assert _code(resp) == "ticket_required"
        assert _rows(db, event.id, human.id) == []

    def test_walk_in_takes_a_free_seat(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a, max_participant=2)
        human = _attendee(db, tenant_a, popup)

        resp = _mark(client, owner, event, human)

        assert resp.status_code == 200, resp.text
        assert resp.json()["created"] is True
        assert resp.json()["entry"]["history"][0]["had_rsvp"] is False

    def test_walk_in_refused_when_full_and_nothing_is_written(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a, max_participant=1)
        holder = _attendee(db, tenant_a, popup)
        walk_in = _attendee(db, tenant_a, popup)
        assert _register(client, holder, event).status_code == 200

        resp = _mark(client, owner, event, walk_in)

        assert resp.status_code == 409, resp.text
        assert _code(resp) == "event_full"
        assert _rows(db, event.id, walk_in.id) == []
        assert _history(db, event.id, walk_in.id) == []

    def test_rsvp_marked_even_when_full(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a, max_participant=1)
        holder = _attendee(db, tenant_a, popup)
        assert _register(client, holder, event).status_code == 200

        resp = _mark(client, owner, event, holder)

        assert resp.status_code == 200, resp.text

    def test_marking_twice_never_duplicates(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a)
        human = _attendee(db, tenant_a, popup)

        first = _mark(client, owner, event, human)
        second = _mark(client, owner, event, human)

        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert second.json()["already_checked_in"] is True
        assert len(_rows(db, event.id, human.id)) == 1
        assert len(_history(db, event.id, human.id)) == 1

    def test_private_event_walk_in_must_be_invited(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a, visibility=EventVisibility.PRIVATE)
        stranger = _attendee(db, tenant_a, popup)
        guest = _attendee(db, tenant_a, popup)
        db.add(
            EventInvitations(
                tenant_id=tenant_a.id, event_id=event.id, human_id=guest.id
            )
        )
        db.commit()

        refused = _mark(client, owner, event, stranger)
        accepted = _mark(client, owner, event, guest)

        assert refused.status_code == 403, refused.text
        assert _code(refused) == "attendee_not_invited"
        assert _rows(db, event.id, stranger.id) == []
        assert accepted.status_code == 200, accepted.text

    def test_event_host_cannot_be_marked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        host = _attendee(db, tenant_a, popup)
        event = _make_event(
            db,
            tenant_a,
            popup,
            owner_id=owner.id,
            host_id=host.id,
            attendance_mode=AttendanceMode.HOST_ROLLCALL,
        )

        resp = _mark(client, owner, event, host)

        assert resp.status_code == 409, resp.text
        assert _code(resp) == "event_host_cannot_attend"


# ---------------------------------------------------------------------------
# The window
# ---------------------------------------------------------------------------


class TestWindow:
    def test_mark_refused_before_the_window(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a, starts_in=timedelta(minutes=31))
        human = _attendee(db, tenant_a, popup)

        resp = _mark(client, owner, event, human)

        assert resp.status_code == 403, resp.text
        assert _code(resp) == "check_in_not_open"

    def test_mark_allowed_just_inside_both_edges(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        early = _make_event(
            db,
            tenant_a,
            popup,
            owner_id=owner.id,
            starts_in=timedelta(minutes=29),
            attendance_mode=AttendanceMode.HOST_ROLLCALL,
        )
        late = _make_event(
            db,
            tenant_a,
            popup,
            owner_id=owner.id,
            starts_in=-(timedelta(hours=1) + timedelta(minutes=119)),
            attendance_mode=AttendanceMode.HOST_ROLLCALL,
        )
        human = _attendee(db, tenant_a, popup)

        assert _mark(client, owner, early, human).status_code == 200
        assert _mark(client, owner, late, human).status_code == 200

    def test_mark_and_void_refused_after_the_window(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a)
        human = _attendee(db, tenant_a, popup)
        other = _attendee(db, tenant_a, popup)
        assert _mark(client, owner, event, human).status_code == 200

        _shift_event(db, event, -timedelta(hours=4))
        void = _void(client, owner, event, human)
        mark = _mark(client, owner, event, other)

        for resp in (void, mark):
            assert resp.status_code == 403, resp.text
            assert _code(resp) == "check_in_closed"
        assert _status(db, event.id, human.id) == ParticipantStatus.CHECKED_IN
        assert _history(db, event.id, human.id)[0].voided_at is None


# ---------------------------------------------------------------------------
# Voids
# ---------------------------------------------------------------------------


class TestVoid:
    def test_voiding_a_qr_check_in_keeps_the_record(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a, mode=AttendanceMode.SELF_CHECKIN)
        human = _attendee(db, tenant_a, popup)
        assert _register(client, human, event).status_code == 200
        assert _check_in(client, human, event).status_code == 200

        resp = _void(client, owner, event, human, reason="Left before it started")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        # They still hold their RSVP: the void undoes the mark, not the seat.
        assert body["status"] == "registered"
        record = body["history"][0]
        assert record["method"] == "qr"
        assert record["checked_in_by"]["id"] == str(human.id)
        assert record["voided_by"]["kind"] == "human"
        assert record["voided_by"]["id"] == str(owner.id)
        assert record["void_reason"] == "Left before it started"
        assert record["voided_at"] is not None

        roster = client.get(
            ROSTER_URL.format(event_id=event.id), headers=_headers(owner)
        ).json()
        assert roster["checked_in_count"] == 0
        assert roster["seats_taken"] == 1

    def test_voiding_a_walk_in_frees_the_seat(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a, max_participant=1)
        wrong = _attendee(db, tenant_a, popup)
        right = _attendee(db, tenant_a, popup)
        assert _mark(client, owner, event, wrong).status_code == 200
        assert _mark(client, owner, event, right).status_code == 409

        assert _void(client, owner, event, wrong).status_code == 200
        resp = _mark(client, owner, event, right)

        assert resp.status_code == 200, resp.text
        assert _status(db, event.id, wrong.id) == ParticipantStatus.CANCELLED
        # The voided walk-in stays visible on the roll call, with its history.
        roster = client.get(
            ROSTER_URL.format(event_id=event.id), headers=_headers(owner)
        ).json()
        by_id = {e["profile_id"]: e for e in roster["entries"]}
        assert by_id[str(wrong.id)]["status"] == "cancelled"
        assert by_id[str(wrong.id)]["history"][0]["voided_at"] is not None
        assert roster["seats_taken"] == 1

    def test_mark_after_void_adds_to_the_history(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a)
        human = _attendee(db, tenant_a, popup)
        assert _mark(client, owner, event, human).status_code == 200
        assert _void(client, owner, event, human).status_code == 200

        resp = _mark(client, owner, event, human)

        assert resp.status_code == 200, resp.text
        history = _history(db, event.id, human.id)
        assert len(history) == 2
        assert history[0].voided_at is not None
        assert history[0].void_reason == "Scanned by mistake"
        assert history[1].voided_at is None
        assert _status(db, event.id, human.id) == ParticipantStatus.CHECKED_IN

    def test_void_requires_a_reason(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a)
        human = _attendee(db, tenant_a, popup)
        assert _mark(client, owner, event, human).status_code == 200

        resp = _void(client, owner, event, human, reason="")

        assert resp.status_code == 422, resp.text
        assert _status(db, event.id, human.id) == ParticipantStatus.CHECKED_IN

    def test_void_of_someone_not_checked_in(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(db, tenant_a)
        human = _attendee(db, tenant_a, popup)
        assert _register(client, human, event).status_code == 200

        resp = _void(client, owner, event, human)

        assert resp.status_code == 409, resp.text
        assert _code(resp) == "not_checked_in"

    def test_void_of_a_check_in_without_history(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A mark from before the history table is still voidable."""
        popup, owner, event = _setup(db, tenant_a)
        human = _attendee(db, tenant_a, popup)
        db.add(
            EventParticipants(
                tenant_id=tenant_a.id,
                event_id=event.id,
                profile_id=human.id,
                status=ParticipantStatus.CHECKED_IN,
                check_time=datetime.now(UTC),
            )
        )
        db.commit()

        resp = _void(client, owner, event, human)

        assert resp.status_code == 200, resp.text
        # Unknown origin: treated as holding an RSVP, so no seat is freed.
        assert resp.json()["status"] == "registered"
        history = _history(db, event.id, human.id)
        assert len(history) == 1
        assert history[0].checked_in_by_human_id is None
        assert history[0].voided_by_human_id == owner.id


# ---------------------------------------------------------------------------
# Recurring series
# ---------------------------------------------------------------------------


class TestRecurring:
    def test_marks_are_scoped_to_one_occurrence(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup, owner, event = _setup(
            db, tenant_a, rrule="FREQ=DAILY;INTERVAL=1;COUNT=3"
        )
        human = _attendee(db, tenant_a, popup)
        today = event.start_time
        tomorrow = today + timedelta(days=1)
        for occ in (today, tomorrow):
            assert (
                _register(
                    client, human, event, occurrence_start=occ.isoformat()
                ).status_code
                == 200
            )

        mark = _mark(client, owner, event, human, occurrence_start=today.isoformat())
        early = _mark(
            client, owner, event, human, occurrence_start=tomorrow.isoformat()
        )

        assert mark.status_code == 200, mark.text
        # Tomorrow's window is not open yet.
        assert early.status_code == 403, early.text
        rows = {r.occurrence_start: r.status for r in _rows(db, event.id, human.id)}
        assert rows[today] == ParticipantStatus.CHECKED_IN
        assert rows[tomorrow] == ParticipantStatus.REGISTERED

        tomorrow_roster = client.get(
            ROSTER_URL.format(event_id=event.id),
            headers=_headers(owner),
            params={"occurrence_start": tomorrow.isoformat()},
        ).json()
        assert tomorrow_roster["checked_in_count"] == 0
        assert tomorrow_roster["entries"][0]["status"] == "registered"

    def test_recurring_needs_an_occurrence(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        _, owner, event = _setup(db, tenant_a, rrule="FREQ=DAILY;INTERVAL=1;COUNT=3")

        resp = client.get(ROSTER_URL.format(event_id=event.id), headers=_headers(owner))

        assert resp.status_code == 400, resp.text
        assert _code(resp) == "occurrence_required"


# ---------------------------------------------------------------------------
# Backoffice
# ---------------------------------------------------------------------------


class TestBackoffice:
    def test_operator_takes_attendance(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        operator_token_tenant_a: str,
        operator_user_tenant_a,
    ) -> None:
        popup, _, event = _setup(db, tenant_a)
        human = _attendee(db, tenant_a, popup)
        headers = _admin(operator_token_tenant_a)

        found = client.get(
            ADMIN_LOOKUP_URL.format(event_id=event.id),
            headers=headers,
            params={"email": human.email},
        )
        mark = client.post(
            ADMIN_MARK_URL.format(event_id=event.id),
            headers=headers,
            json={"profile_id": str(human.id)},
        )
        void = client.post(
            ADMIN_VOID_URL.format(event_id=event.id),
            headers=headers,
            json={"profile_id": str(human.id), "reason": "Wrong person"},
        )
        roster = client.get(ADMIN_ROSTER_URL.format(event_id=event.id), headers=headers)

        assert found.status_code == 200, found.text
        assert mark.status_code == 200, mark.text
        assert mark.json()["entry"]["history"][0]["checked_in_by"] == {
            "kind": "user",
            "id": str(operator_user_tenant_a.id),
            "name": operator_user_tenant_a.full_name or operator_user_tenant_a.email,
        }
        assert void.status_code == 200, void.text
        assert void.json()["history"][0]["voided_by"]["kind"] == "user"
        assert roster.status_code == 200, roster.text

    def test_viewer_cannot_take_attendance(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        viewer_token_tenant_a: str,
    ) -> None:
        popup, _, event = _setup(db, tenant_a)
        human = _attendee(db, tenant_a, popup)

        resp = client.post(
            ADMIN_MARK_URL.format(event_id=event.id),
            headers=_admin(viewer_token_tenant_a),
            json={"profile_id": str(human.id)},
        )

        assert resp.status_code == 403, resp.text
        assert _rows(db, event.id, human.id) == []


# ---------------------------------------------------------------------------
# Concurrency: a walk-in and a scan for the last seat
# ---------------------------------------------------------------------------


def test_walk_in_and_scan_cannot_both_take_the_last_seat(
    db: Session, test_engine, tenant_a: Tenants
) -> None:
    popup, owner, event = _setup(
        db, tenant_a, mode=AttendanceMode.SELF_CHECKIN, max_participant=1
    )
    scanner = _attendee(db, tenant_a, popup)
    walk_in = _attendee(db, tenant_a, popup)

    barrier = threading.Barrier(2)
    outcomes: dict[str, str] = {}
    lock = threading.Lock()

    def attempt(label: str, human_id: uuid.UUID, method: CheckInMethod) -> None:
        with Session(test_engine) as session:
            local_event = session.get(Events, event.id)
            local_human = session.get(Humans, human_id)
            barrier.wait(timeout=10)
            try:
                perform_check_in(
                    session,
                    local_event,
                    local_human,
                    None,
                    method=method,
                    actor_human_id=owner.id if method == CheckInMethod.MANUAL else None,
                )
                outcome = "checked_in"
            except HTTPException as exc:
                detail = exc.detail
                outcome = (
                    detail.get("code") if isinstance(detail, dict) else str(detail)
                )
            with lock:
                outcomes[label] = outcome

    threads = [
        threading.Thread(
            target=attempt, args=("scan", scanner.id, CheckInMethod.QR), daemon=True
        ),
        threading.Thread(
            target=attempt,
            args=("manual", walk_in.id, CheckInMethod.MANUAL),
            daemon=True,
        ),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert sorted(outcomes.values()) == ["checked_in", "event_full"], outcomes
    db.expire_all()
    active = db.exec(
        select(EventParticipants)
        .where(EventParticipants.event_id == event.id)
        .where(EventParticipants.status != ParticipantStatus.CANCELLED)
    ).all()
    assert len(active) == 1
    logged = db.exec(
        select(EventCheckIns).where(EventCheckIns.event_id == event.id)
    ).all()
    assert len(logged) == 1


def test_detached_occurrence_takes_its_attendance_along(
    client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a: str
) -> None:
    popup, owner, event = _setup(db, tenant_a, rrule="FREQ=DAILY;INTERVAL=1;COUNT=3")
    human = _attendee(db, tenant_a, popup)
    occ = event.start_time
    assert (
        _mark(client, owner, event, human, occurrence_start=occ.isoformat()).status_code
        == 200
    )

    resp = client.post(
        f"/api/v1/events/{event.id}/detach-occurrence",
        headers=_admin(admin_token_tenant_a),
        json={"occurrence_start": occ.isoformat()},
    )

    assert resp.status_code == 200, resp.text
    child_id = uuid.UUID(resp.json()["id"])
    assert resp.json()["attendance_mode"] == "host_rollcall"
    history = _history(db, child_id, human.id)
    assert len(history) == 1
    assert history[0].occurrence_start is None
    roster = client.get(ROSTER_URL.format(event_id=child_id), headers=_headers(owner))
    assert roster.status_code == 200, roster.text
    assert roster.json()["checked_in_count"] == 1


def test_third_party_token_cannot_take_attendance_or_change_the_mode(
    client: TestClient, db: Session, tenant_a: Tenants, third_party_jwt_factory
) -> None:
    """Managing attendance needs the organizer's own portal session."""
    popup, owner, event = _setup(db, tenant_a)
    human = _attendee(db, tenant_a, popup)
    headers = {"Authorization": f"Bearer {third_party_jwt_factory(human=owner)}"}

    responses = [
        client.get(ROSTER_URL.format(event_id=event.id), headers=headers),
        client.post(
            MARK_URL.format(event_id=event.id),
            headers=headers,
            json={"profile_id": str(human.id)},
        ),
        client.put(
            MODE_URL.format(event_id=event.id),
            headers=headers,
            json={"attendance_mode": "self_checkin"},
        ),
    ]

    for resp in responses:
        assert resp.status_code == 403, resp.text
    assert _rows(db, event.id, human.id) == []
    db.refresh(event)
    assert event.attendance_mode == AttendanceMode.HOST_ROLLCALL
