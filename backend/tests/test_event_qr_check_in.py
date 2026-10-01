"""Integration tests for QR check-in to an event (SIM-103).

The organizer projects a QR encoding a fixed portal URL; scanning it POSTs
once to ``/event-participants/portal/check-in/{event_id}``. That POST may
create the participation, so it carries the whole RSVP gate plus a time
window that previously lived only in the UI.

Covers:
- Check-in with no prior RSVP creates a CHECKED_IN row directly.
- A REGISTERED row is flipped without a capacity check (the seat was theirs).
- A second scan is an informational success, never a duplicate row.
- A cancelled row is a fresh entry: eligibility and capacity apply again.
- Eligibility (ticket / not rejected), publication, popup status,
  event_enabled and event visibility all reject before anything is written.
- The 30-minutes-before / 2-hours-after window is enforced server-side.
- Recurring series record attendance against the scanned occurrence only.
- Two simultaneous scans cannot both take the last seat.
- The direct check-in never sends the RSVP flow's iTIP message.
- The QR link endpoint is served to managers and to nobody else.
"""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.event.models import EventInvitations, Events
from app.api.event.schemas import AttendanceMode, EventStatus, EventVisibility
from app.api.event_participant.check_in import (
    CHECK_IN_CLOSES_MINUTES_AFTER,
    CHECK_IN_OPENS_MINUTES_BEFORE,
    perform_check_in,
)
from app.api.event_participant.models import EventParticipants
from app.api.event_participant.schemas import ParticipantStatus
from app.api.event_settings.models import EventSettings
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import application_flow_id

CHECK_IN_URL = "/api/v1/event-participants/portal/check-in/{event_id}"
LINK_URL = "/api/v1/events/portal/events/{event_id}/check-in-link"

# The router reaches iTIP lazily through app.services.event_itip, so patching
# the module attribute intercepts every dispatch the RSVP path would make.
_ITIP_TARGET = "app.services.event_itip.send_itip_to_single_recipient"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(
    db: Session, tenant: Tenants, *, status: PopupStatus = PopupStatus.active
) -> Popups:
    popup = Popups(
        name=f"QR Check-in {uuid.uuid4().hex[:6]}",
        slug=f"qr-checkin-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
        status=status,
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
    visibility: EventVisibility = EventVisibility.PUBLIC,
    max_participant: int | None = None,
    # Default puts "now" inside the window: the event started 10 minutes ago.
    starts_in: timedelta = timedelta(minutes=-10),
    duration: timedelta = timedelta(hours=1),
    rrule: str | None = None,
    owner_id: uuid.UUID | None = None,
    host_id: uuid.UUID | None = None,
    collaborator_ids: list[uuid.UUID] | None = None,
    host_display_name: str | None = None,
    cover_url: str | None = None,
    # The QR only works in self_checkin (SIM-106), which is what every test
    # here exercises unless it says otherwise.
    attendance_mode: AttendanceMode = AttendanceMode.SELF_CHECKIN,
) -> Events:
    start = datetime.now(UTC) + starts_in
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=owner_id or uuid.uuid4(),
        host_id=host_id,
        collaborator_ids=collaborator_ids or [],
        host_display_name=host_display_name,
        title="Sunset talk",
        start_time=start,
        end_time=start + duration,
        timezone="UTC",
        visibility=visibility,
        status=status,
        max_participant=max_participant,
        rrule=rrule,
        cover_url=cover_url,
        attendance_mode=attendance_mode,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"qr-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Scan",
        last_name="Ner",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _give_ticket(db: Session, tenant: Tenants, popup: Popups, human: Humans) -> None:
    """Seed the purchased ticket RSVP eligibility requires."""
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Ticket {uuid.uuid4().hex[:6]}",
        slug=f"ticket-{uuid.uuid4().hex[:10]}",
        price=Decimal("100.00"),
        category="ticket",
    )
    db.add(product)
    db.commit()
    db.refresh(product)

    attendee = Attendees(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        name=f"{human.first_name} {human.last_name}".strip(),
        email=human.email,
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)

    db.add(
        AttendeeProducts(
            tenant_id=tenant.id,
            attendee_id=attendee.id,
            product_id=product.id,
            check_in_code=uuid.uuid4().hex[:10],
            product_category_snapshot="ticket",
        )
    )
    db.commit()


def _headers(human: Humans) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {create_access_token(subject=human.id, token_type='human')}"
    }


def _rows(
    db: Session, event_id: uuid.UUID, profile_id: uuid.UUID
) -> list[EventParticipants]:
    db.expire_all()
    return list(
        db.exec(
            select(EventParticipants)
            .where(EventParticipants.event_id == event_id)
            .where(EventParticipants.profile_id == profile_id)
        ).all()
    )


def _code(response) -> str | None:
    detail = response.json().get("detail")
    return detail.get("code") if isinstance(detail, dict) else None


def _check_in(client: TestClient, human: Humans, event: Events, **body):
    """POST the check-in, with iTIP patched so a leak would be observable."""
    with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)) as itip:
        response = client.post(
            CHECK_IN_URL.format(event_id=event.id),
            headers=_headers(human),
            json=body or None,
        )
    response.itip = itip  # type: ignore[attr-defined]
    return response


def _register(client: TestClient, human: Humans, event: Events, **body):
    with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
        return client.post(
            f"/api/v1/event-participants/portal/register/{event.id}",
            headers=_headers(human),
            json=body or None,
        )


# ---------------------------------------------------------------------------
# The happy paths — the four states of a participation
# ---------------------------------------------------------------------------


class TestCheckInStateMachine:
    def test_event_host_cannot_check_in_as_a_participant(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        host = _make_human(db, tenant_a)
        event = _make_event(db, tenant_a, popup, host_id=host.id)

        response = _check_in(client, host, event)

        assert response.status_code == 409, response.text
        assert _code(response) == "event_host_cannot_attend"
        assert _rows(db, event.id, host.id) == []

    def test_creates_participation_without_prior_rsvp(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, cover_url="https://img/cover.png")
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        before = datetime.now(UTC)
        resp = _check_in(client, human, event)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["created"] is True
        assert body["already_checked_in"] is False
        assert body["participant"]["status"] == ParticipantStatus.CHECKED_IN.value
        assert body["participant"]["check_time"] is not None
        assert body["event"]["title"] == "Sunset talk"
        assert body["event"]["cover_url"] == "https://img/cover.png"
        assert body["event"]["popup_slug"] == popup.slug

        rows = _rows(db, event.id, human.id)
        assert len(rows) == 1
        assert rows[0].status == ParticipantStatus.CHECKED_IN
        assert rows[0].check_time is not None
        assert rows[0].check_time >= before - timedelta(seconds=5)

    def test_flips_existing_registration(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)
        assert _register(client, human, event).status_code == 200

        resp = _check_in(client, human, event)

        assert resp.status_code == 200, resp.text
        assert resp.json()["created"] is False
        assert resp.json()["already_checked_in"] is False
        rows = _rows(db, event.id, human.id)
        assert len(rows) == 1
        assert rows[0].status == ParticipantStatus.CHECKED_IN

    def test_registered_can_check_in_even_when_event_is_full(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Their seat was already reserved; a full house must not evict them."""
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, max_participant=1)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)
        assert _register(client, human, event).status_code == 200

        # The event is now at capacity — with this human being the capacity.
        resp = _check_in(client, human, event)

        assert resp.status_code == 200, resp.text
        assert _rows(db, event.id, human.id)[0].status == ParticipantStatus.CHECKED_IN

    def test_second_scan_is_informational_success(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        first = _check_in(client, human, event)
        assert first.status_code == 200, first.text
        first_check_time = first.json()["participant"]["check_time"]

        second = _check_in(client, human, event)

        assert second.status_code == 200, second.text
        assert second.json()["already_checked_in"] is True
        assert second.json()["created"] is False
        # The original timestamp stands: the first scan is when they arrived.
        assert second.json()["participant"]["check_time"] == first_check_time
        assert len(_rows(db, event.id, human.id)) == 1

    def test_cancelled_row_is_reactivated_as_checked_in(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)
        assert _register(client, human, event).status_code == 200
        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
            client.post(
                f"/api/v1/event-participants/portal/cancel-registration/{event.id}",
                headers=_headers(human),
            )

        resp = _check_in(client, human, event)

        assert resp.status_code == 200, resp.text
        rows = _rows(db, event.id, human.id)
        assert len(rows) == 1
        assert rows[0].status == ParticipantStatus.CHECKED_IN

    def test_cancelled_row_is_subject_to_capacity_again(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, max_participant=1)
        taker = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, taker)
        returning = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, returning)

        assert _register(client, returning, event).status_code == 200
        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
            client.post(
                f"/api/v1/event-participants/portal/cancel-registration/{event.id}",
                headers=_headers(returning),
            )
        # Someone else took the freed seat in the meantime.
        assert _check_in(client, taker, event).status_code == 200

        resp = _check_in(client, returning, event)

        assert resp.status_code == 409, resp.text
        assert _code(resp) == "event_full"
        assert (
            _rows(db, event.id, returning.id)[0].status == ParticipantStatus.CANCELLED
        )

    def test_full_event_rejects_a_newcomer_without_writing(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, max_participant=1)
        seated = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, seated)
        latecomer = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, latecomer)
        assert _register(client, seated, event).status_code == 200

        resp = _check_in(client, latecomer, event)

        assert resp.status_code == 409, resp.text
        assert _code(resp) == "event_full"
        assert _rows(db, event.id, latecomer.id) == []

    def test_direct_check_in_sends_no_itip(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A check-in is not an invitation — no calendar mail on this path."""
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        resp = _check_in(client, human, event)

        assert resp.status_code == 200, resp.text
        resp.itip.assert_not_called()


# ---------------------------------------------------------------------------
# Eligibility and gathering state
# ---------------------------------------------------------------------------


class TestCheckInEligibility:
    def test_without_ticket_is_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        resp = _check_in(client, human, event)

        assert resp.status_code == 403, resp.text
        assert _code(resp) == "ticket_required"
        assert _rows(db, event.id, human.id) == []

    def test_rejected_application_is_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)
        db.add(
            Applications(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                human_id=human.id,
                sales_flow_id=application_flow_id(db, popup.id),
                status=ApplicationStatus.REJECTED.value,
            )
        )
        db.commit()

        resp = _check_in(client, human, event)

        assert resp.status_code == 403, resp.text
        assert _code(resp) == "application_rejected"

    def test_managers_still_need_a_ticket(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Running the event grants the QR, not a seat at it."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        event = _make_event(db, tenant_a, popup, owner_id=human.id)

        resp = _check_in(client, human, event)

        assert resp.status_code == 403, resp.text
        assert _code(resp) == "ticket_required"

    def test_owner_with_ticket_checks_in_without_rsvp(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)
        event = _make_event(db, tenant_a, popup, owner_id=human.id)

        resp = _check_in(client, human, event)

        assert resp.status_code == 200, resp.text
        assert resp.json()["created"] is True

    def test_unpublished_event_is_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, status=EventStatus.DRAFT)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        resp = _check_in(client, human, event)

        assert resp.status_code == 400, resp.text
        assert _code(resp) == "event_not_published"

    def test_ended_popup_is_read_only(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, status=PopupStatus.ended)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        resp = _check_in(client, human, event)

        assert resp.status_code == 403, resp.text
        assert _rows(db, event.id, human.id) == []

    def test_disabled_events_module_is_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        settings = db.exec(
            select(EventSettings).where(EventSettings.popup_id == popup.id)
        ).first()
        if settings is None:
            settings = EventSettings(tenant_id=tenant_a.id, popup_id=popup.id)
        settings.event_enabled = False
        db.add(settings)
        db.commit()
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        resp = _check_in(client, human, event)

        assert resp.status_code == 403, resp.text
        assert _code(resp) == "events_disabled"

    def test_private_event_without_invitation_is_not_found(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The QR leaks nothing about an event the scanner can't even see."""
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, visibility=EventVisibility.PRIVATE)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        resp = _check_in(client, human, event)

        assert resp.status_code == 404, resp.text
        assert _rows(db, event.id, human.id) == []

    def test_private_event_with_invitation_is_allowed(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, visibility=EventVisibility.PRIVATE)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)
        db.add(
            EventInvitations(
                tenant_id=tenant_a.id, event_id=event.id, human_id=human.id
            )
        )
        db.commit()

        resp = _check_in(client, human, event)

        assert resp.status_code == 200, resp.text

    def test_check_in_always_binds_to_the_caller(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """No way to check somebody else in: the body carries no identity."""
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        caller = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, caller)
        victim = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, victim)

        resp = _check_in(client, caller, event, profile_id=str(victim.id))

        assert resp.status_code == 200, resp.text
        assert resp.json()["participant"]["profile_id"] == str(caller.id)
        assert _rows(db, event.id, victim.id) == []

    def test_anonymous_scan_is_unauthorized(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)

        resp = client.post(CHECK_IN_URL.format(event_id=event.id))

        assert resp.status_code in (401, 403), resp.text


# ---------------------------------------------------------------------------
# Time window
# ---------------------------------------------------------------------------


class TestCheckInWindow:
    def test_too_early_is_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(
            db,
            tenant_a,
            popup,
            starts_in=timedelta(minutes=CHECK_IN_OPENS_MINUTES_BEFORE + 15),
        )
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        resp = _check_in(client, human, event)

        assert resp.status_code == 403, resp.text
        assert _code(resp) == "check_in_not_open"
        assert _rows(db, event.id, human.id) == []

    def test_opens_before_the_start(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(
            db,
            tenant_a,
            popup,
            starts_in=timedelta(minutes=CHECK_IN_OPENS_MINUTES_BEFORE - 5),
        )
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        resp = _check_in(client, human, event)

        assert resp.status_code == 200, resp.text

    def test_too_late_is_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(
            db,
            tenant_a,
            popup,
            starts_in=-timedelta(hours=1, minutes=CHECK_IN_CLOSES_MINUTES_AFTER + 30),
            duration=timedelta(hours=1),
        )
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        resp = _check_in(client, human, event)

        assert resp.status_code == 403, resp.text
        assert _code(resp) == "check_in_closed"

    def test_still_open_shortly_after_the_end(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(
            db,
            tenant_a,
            popup,
            starts_in=-timedelta(hours=1, minutes=CHECK_IN_CLOSES_MINUTES_AFTER - 30),
            duration=timedelta(hours=1),
        )
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        resp = _check_in(client, human, event)

        assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# Recurring series
# ---------------------------------------------------------------------------


class TestCheckInOccurrences:
    def test_recurring_event_requires_an_occurrence(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, rrule="FREQ=DAILY;INTERVAL=1;COUNT=3")
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        resp = _check_in(client, human, event)

        assert resp.status_code == 400, resp.text
        # Coded, not the shared resolver's developer string: this detail is
        # shown to whoever just scanned the QR.
        assert _code(resp) == "occurrence_not_scheduled"

    def test_occurrence_on_a_one_off_event_is_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)

        resp = _check_in(
            client, human, event, occurrence_start=event.start_time.isoformat()
        )

        assert resp.status_code == 400, resp.text
        assert _code(resp) == "occurrence_not_scheduled"
        assert _rows(db, event.id, human.id) == []

    def test_unscheduled_occurrence_is_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A hand-edited ?occ= must not open a registration on a made-up date."""
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, rrule="FREQ=DAILY;INTERVAL=1;COUNT=3")
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)
        invented = (event.start_time + timedelta(minutes=37)).isoformat()

        resp = _check_in(client, human, event, occurrence_start=invented)

        assert resp.status_code == 400, resp.text
        assert _code(resp) == "occurrence_not_scheduled"
        assert _rows(db, event.id, human.id) == []

    def test_check_in_is_scoped_to_the_scanned_occurrence(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, rrule="FREQ=DAILY;INTERVAL=1;COUNT=3")
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)
        first = event.start_time

        resp = _check_in(client, human, event, occurrence_start=first.isoformat())

        assert resp.status_code == 200, resp.text
        rows = _rows(db, event.id, human.id)
        assert len(rows) == 1
        assert rows[0].occurrence_start == first
        # Tomorrow's instance is untouched: it has no row of its own.
        assert all(r.occurrence_start != first + timedelta(days=1) for r in rows)


# ---------------------------------------------------------------------------
# Concurrency — the last seat
# ---------------------------------------------------------------------------


def test_simultaneous_scans_cannot_both_take_the_last_seat(
    db: Session, test_engine, tenant_a: Tenants
) -> None:
    """Two scans land at once on a one-seat event; exactly one gets in.

    Driven against ``perform_check_in`` with two real sessions rather than
    through TestClient, because the point under test is the ``SELECT ... FOR
    UPDATE`` in Postgres and TestClient gives no control over overlap. Both
    threads are released from the same barrier so their count-then-insert
    windows genuinely overlap.
    """
    popup = _make_popup(db, tenant_a)
    event = _make_event(db, tenant_a, popup, max_participant=1)
    humans = [_make_human(db, tenant_a) for _ in range(2)]
    for human in humans:
        _give_ticket(db, tenant_a, popup, human)

    barrier = threading.Barrier(len(humans))
    outcomes: dict[uuid.UUID, str] = {}
    lock = threading.Lock()

    def scan(human_id: uuid.UUID) -> None:
        with Session(test_engine) as session:
            local_event = session.get(Events, event.id)
            local_human = session.get(Humans, human_id)
            barrier.wait(timeout=10)
            try:
                perform_check_in(session, local_event, local_human, None)
                outcome = "checked_in"
            except HTTPException as exc:
                detail = exc.detail
                outcome = (
                    detail.get("code") if isinstance(detail, dict) else str(detail)
                )
            with lock:
                outcomes[human_id] = outcome

    threads = [
        threading.Thread(target=scan, args=(human.id,), daemon=True) for human in humans
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


# ---------------------------------------------------------------------------
# The QR link endpoint
# ---------------------------------------------------------------------------


class TestCheckInLink:
    @pytest.mark.parametrize("role", ["owner", "host", "collaborator"])
    def test_managers_get_the_link(
        self, client: TestClient, db: Session, tenant_a: Tenants, role: str
    ) -> None:
        popup = _make_popup(db, tenant_a)
        manager = _make_human(db, tenant_a)
        kwargs = {
            "owner": {"owner_id": manager.id},
            "host": {"host_id": manager.id},
            "collaborator": {"collaborator_ids": [manager.id]},
        }[role]
        event = _make_event(db, tenant_a, popup, **kwargs)

        resp = client.get(LINK_URL.format(event_id=event.id), headers=_headers(manager))

        assert resp.status_code == 200, resp.text
        url = resp.json()["url"]
        assert f"/portal/{popup.slug}/events/{event.id}/check-in" in url
        assert url.startswith("http")
        assert resp.json()["occurrence_start"] is None

    def test_plain_attendee_is_forbidden(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, human)
        assert _register(client, human, event).status_code == 200

        resp = client.get(LINK_URL.format(event_id=event.id), headers=_headers(human))

        assert resp.status_code == 403, resp.text

    def test_host_display_name_grants_nothing(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """It's a label for attendees, not an identity and not a permission."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        event = _make_event(
            db,
            tenant_a,
            popup,
            host_display_name=f"{human.first_name} {human.last_name}",
        )

        resp = client.get(LINK_URL.format(event_id=event.id), headers=_headers(human))

        assert resp.status_code == 403, resp.text

    def test_anonymous_is_unauthorized(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)

        resp = client.get(LINK_URL.format(event_id=event.id))

        assert resp.status_code in (401, 403), resp.text

    def test_recurring_link_carries_the_occurrence(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        manager = _make_human(db, tenant_a)
        event = _make_event(
            db,
            tenant_a,
            popup,
            owner_id=manager.id,
            rrule="FREQ=DAILY;INTERVAL=1;COUNT=3",
        )
        occ = event.start_time + timedelta(days=1)

        resp = client.get(
            LINK_URL.format(event_id=event.id),
            params={"occurrence_start": occ.isoformat()},
            headers=_headers(manager),
        )

        assert resp.status_code == 200, resp.text
        assert "occ=" in resp.json()["url"]
        assert resp.json()["occurrence_start"] is not None

    def test_recurring_master_without_occ_defaults_to_the_first_instance(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Otherwise the scan would land on the series and record no date."""
        popup = _make_popup(db, tenant_a)
        manager = _make_human(db, tenant_a)
        event = _make_event(
            db,
            tenant_a,
            popup,
            owner_id=manager.id,
            rrule="FREQ=DAILY;INTERVAL=1;COUNT=3",
        )

        resp = client.get(LINK_URL.format(event_id=event.id), headers=_headers(manager))

        assert resp.status_code == 200, resp.text
        assert "occ=" in resp.json()["url"]


# ---------------------------------------------------------------------------
# The two endpoints have to agree
# ---------------------------------------------------------------------------


class TestLinkAndCheckInAgree:
    """What the QR encodes must be what the scan endpoint accepts.

    The link endpoint percent-encodes an ISO instant into ``?occ=``; the
    portal hands that value straight back as ``occurrence_start``. Nothing
    else pins that round trip, so an encoding change on either side would
    otherwise only surface as a scan failing in someone's hand.
    """

    def _scan(self, client: TestClient, human: Humans, url: str):
        """Follow a QR URL the way the portal's landing page does."""
        parsed = urlparse(url)
        event_id = parsed.path.rstrip("/").split("/")[-2]
        occ = parse_qs(parsed.query).get("occ", [None])[0]
        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
            return client.post(
                CHECK_IN_URL.format(event_id=event_id),
                headers=_headers(human),
                json={"occurrence_start": occ} if occ else None,
            )

    def test_one_off_link_checks_the_scanner_in(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        manager = _make_human(db, tenant_a)
        event = _make_event(db, tenant_a, popup, owner_id=manager.id)
        scanner = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, scanner)

        link = client.get(LINK_URL.format(event_id=event.id), headers=_headers(manager))
        assert link.status_code == 200, link.text

        resp = self._scan(client, scanner, link.json()["url"])

        assert resp.status_code == 200, resp.text
        assert _rows(db, event.id, scanner.id)[0].status == ParticipantStatus.CHECKED_IN

    def test_recurring_link_records_the_occurrence_it_encoded(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        manager = _make_human(db, tenant_a)
        event = _make_event(
            db,
            tenant_a,
            popup,
            owner_id=manager.id,
            rrule="FREQ=DAILY;INTERVAL=1;COUNT=3",
        )
        scanner = _make_human(db, tenant_a)
        _give_ticket(db, tenant_a, popup, scanner)

        link = client.get(LINK_URL.format(event_id=event.id), headers=_headers(manager))
        assert link.status_code == 200, link.text

        resp = self._scan(client, scanner, link.json()["url"])

        assert resp.status_code == 200, resp.text
        rows = _rows(db, event.id, scanner.id)
        assert len(rows) == 1
        # The date the QR pointed at, not some other instance of the series.
        assert rows[0].occurrence_start == event.start_time
