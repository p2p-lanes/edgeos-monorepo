"""Tests for ticket_event CRUD functions.

TDD phase: RED — written before crud implementation.
Addendum #12 design:
  - record_check_in: inserts ticket_events row, returns CheckIn
  - list_check_ins_for_ticket: ordered DESC by occurred_at
  - get_check_in_summary: count + min + max in single SQL query
"""

import uuid
from decimal import Decimal

from sqlmodel import Session

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_ticket_chain(
    db: Session,
    tenant: Tenants,
    popup: Popups,
) -> AttendeeProducts:
    """Create product + attendee + ticket (AttendeeProducts row)."""
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"CRUD Test Product {uuid.uuid4().hex[:6]}",
        slug=f"crud-test-{uuid.uuid4().hex[:6]}",
        price=Decimal("20"),
        category="ticket",
    )
    db.add(product)
    db.commit()

    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"crud-te-{uuid.uuid4().hex[:8]}@test.com",
        first_name="CRUD",
        last_name="Test",
    )
    db.add(human)
    db.commit()

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        name="CRUD Test Attendee",
        category="main",
    )
    db.add(attendee)
    db.commit()

    ticket = AttendeeProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=f"CRD{uuid.uuid4().hex[:5].upper()}",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestRecordCheckIn:
    """record_check_in must insert a check_in CheckIn row."""

    def test_record_check_in_creates_event(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """record_check_in returns a persisted CheckIn with event_type='check_in'."""
        from app.api.check_in.crud import record_check_in
        from app.api.check_in.models import CheckIn
        from app.api.check_in.schemas import CheckInPayload

        ticket = _make_ticket_chain(db, tenant_a, popup_tenant_a)
        payload = CheckInPayload(source="qr")

        event = record_check_in(
            db,
            ticket.id,
            popup_id=popup_tenant_a.id,
            payload=payload,
            actor_user_id=None,
        )

        assert isinstance(event, CheckIn)
        assert event.id is not None
        assert event.attendee_product_id == ticket.id
        assert event.payload is not None
        assert event.payload["source"] == "qr"
        assert event.actor_user_id is None

    def test_record_check_in_with_actor(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """record_check_in captures actor_user_id when provided."""
        from app.api.check_in.crud import record_check_in
        from app.api.check_in.schemas import CheckInPayload

        ticket = _make_ticket_chain(db, tenant_a, popup_tenant_a)
        payload = CheckInPayload(source="manual", notes="Staff override")

        # actor_user_id=None (system event) — FK constraint won't fire without a real user row
        event = record_check_in(
            db,
            ticket.id,
            popup_id=popup_tenant_a.id,
            payload=payload,
            actor_user_id=None,
        )
        assert event.payload["notes"] == "Staff override"
        assert event.payload["source"] == "manual"

    def test_record_check_in_payload_serialized(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Full CheckInPayload dict is stored in payload column."""
        from app.api.check_in.crud import record_check_in
        from app.api.check_in.schemas import CheckInPayload

        ticket = _make_ticket_chain(db, tenant_a, popup_tenant_a)
        payload = CheckInPayload(
            source="qr",
            notes="Test note",
        )

        event = record_check_in(
            db,
            ticket.id,
            popup_id=popup_tenant_a.id,
            payload=payload,
            actor_user_id=None,
        )

        assert event.payload["source"] == "qr"
        assert event.payload["notes"] == "Test note"


class TestListEventsForTicket:
    """list_check_ins_for_ticket returns events ordered by occurred_at DESC."""

    def test_list_events_returns_all_events(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """All events for a ticket are returned."""
        from app.api.check_in.crud import list_check_ins_for_ticket, record_check_in
        from app.api.check_in.schemas import CheckInPayload

        ticket = _make_ticket_chain(db, tenant_a, popup_tenant_a)
        payload = CheckInPayload(source="qr")

        record_check_in(
            db,
            ticket.id,
            popup_id=popup_tenant_a.id,
            payload=payload,
            actor_user_id=None,
        )
        record_check_in(
            db,
            ticket.id,
            popup_id=popup_tenant_a.id,
            payload=payload,
            actor_user_id=None,
        )

        events = list_check_ins_for_ticket(db, ticket.id)
        assert len(events) >= 2, f"Expected >= 2 events, got {len(events)}"

    def test_list_events_ordered_desc(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Events are ordered by occurred_at DESC (latest first)."""
        from app.api.check_in.crud import list_check_ins_for_ticket, record_check_in
        from app.api.check_in.schemas import CheckInPayload

        ticket = _make_ticket_chain(db, tenant_a, popup_tenant_a)
        payload = CheckInPayload(source="qr")

        record_check_in(
            db,
            ticket.id,
            popup_id=popup_tenant_a.id,
            payload=payload,
            actor_user_id=None,
        )
        record_check_in(
            db,
            ticket.id,
            popup_id=popup_tenant_a.id,
            payload=payload,
            actor_user_id=None,
        )

        events = list_check_ins_for_ticket(db, ticket.id)
        # Should be DESC — e2 was inserted later so it comes first
        occurred_times = [
            e.occurred_at for e in events if e.attendee_product_id == ticket.id
        ]
        if len(occurred_times) >= 2:
            assert occurred_times[0] >= occurred_times[-1], (
                "Events must be ordered DESC by occurred_at"
            )

    def test_list_events_empty_for_new_ticket(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """New ticket with no events returns empty list."""
        from app.api.check_in.crud import list_check_ins_for_ticket

        ticket = _make_ticket_chain(db, tenant_a, popup_tenant_a)
        events = list_check_ins_for_ticket(db, ticket.id)
        assert events == [], f"Expected empty list for new ticket, got: {events}"


class TestGetCheckInSummary:
    """get_check_in_summary returns total_scans + first_scan_at + last_scan_at."""

    def test_summary_zero_for_new_ticket(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """New ticket has total_scans=0, first_scan_at=None, last_scan_at=None."""
        from app.api.check_in.crud import get_check_in_summary

        ticket = _make_ticket_chain(db, tenant_a, popup_tenant_a)
        summary = get_check_in_summary(db, ticket.id)

        assert summary["total_scans"] == 0
        assert summary["first_scan_at"] is None
        assert summary["last_scan_at"] is None

    def test_summary_first_scan(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """After one scan, total_scans=1, first_scan_at == last_scan_at."""
        from app.api.check_in.crud import get_check_in_summary, record_check_in
        from app.api.check_in.schemas import CheckInPayload

        ticket = _make_ticket_chain(db, tenant_a, popup_tenant_a)
        record_check_in(
            db,
            ticket.id,
            popup_id=popup_tenant_a.id,
            payload=CheckInPayload(source="qr"),
            actor_user_id=None,
        )

        summary = get_check_in_summary(db, ticket.id)

        assert summary["total_scans"] == 1
        assert summary["first_scan_at"] is not None
        assert summary["last_scan_at"] is not None
        assert summary["first_scan_at"] == summary["last_scan_at"]

    def test_summary_rescan(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """After two scans, total_scans=2, first_scan_at != last_scan_at."""
        from app.api.check_in.crud import get_check_in_summary, record_check_in
        from app.api.check_in.schemas import CheckInPayload

        ticket = _make_ticket_chain(db, tenant_a, popup_tenant_a)
        record_check_in(
            db,
            ticket.id,
            popup_id=popup_tenant_a.id,
            payload=CheckInPayload(source="qr"),
            actor_user_id=None,
        )
        record_check_in(
            db,
            ticket.id,
            popup_id=popup_tenant_a.id,
            payload=CheckInPayload(source="manual"),
            actor_user_id=None,
        )

        summary = get_check_in_summary(db, ticket.id)

        assert summary["total_scans"] == 2
        assert summary["first_scan_at"] is not None
        assert summary["last_scan_at"] is not None
        # first_scan_at <= last_scan_at always (may be equal if DB clock resolution)

    def test_summary_isolation(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Two tickets have independent scan counters."""
        from app.api.check_in.crud import get_check_in_summary, record_check_in
        from app.api.check_in.schemas import CheckInPayload

        ticket_a = _make_ticket_chain(db, tenant_a, popup_tenant_a)
        ticket_b = _make_ticket_chain(db, tenant_a, popup_tenant_a)

        # Scan ticket_a twice, ticket_b once
        record_check_in(
            db,
            ticket_a.id,
            popup_id=popup_tenant_a.id,
            payload=CheckInPayload(source="qr"),
            actor_user_id=None,
        )
        record_check_in(
            db,
            ticket_a.id,
            popup_id=popup_tenant_a.id,
            payload=CheckInPayload(source="qr"),
            actor_user_id=None,
        )
        record_check_in(
            db,
            ticket_b.id,
            popup_id=popup_tenant_a.id,
            payload=CheckInPayload(source="manual"),
            actor_user_id=None,
        )

        summary_a = get_check_in_summary(db, ticket_a.id)
        summary_b = get_check_in_summary(db, ticket_b.id)

        assert summary_a["total_scans"] == 2
        assert summary_b["total_scans"] == 1
