"""Integration tests for the check-in pass dispatch job.

Invokes ``dispatch_checkin_passes`` directly — the job is meant to run as a
standalone Python module from a scheduler (no HTTP endpoint, no auth surface),
so the tests exercise the service entrypoint rather than going through FastAPI.

Coverage:
- happy path: one email to the buyer with all their QR codes, tickets stamped
- idempotency: a second run sends nothing
- window: popups whose start is too far in the future are skipped
- post-start tail: popups whose event has started but not ended still send
  (covers tickets purchased after the event begins)
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.services.checkin_pass_dispatch import dispatch_checkin_passes

QR_TARGET = "app.services.checkin_pass_dispatch.generate_checkin_qr_url"
EMAIL_TARGET = "app.services.checkin_pass_dispatch.get_email_service"

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    start_in_hours: float,
    end_in_days: float | None = 30,
    lead_days: int | None = 3,
) -> Popups:
    now = datetime.now(UTC)
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Pass Popup {uuid.uuid4().hex[:6]}",
        slug=f"pass-{uuid.uuid4().hex[:8]}",
        start_date=now + timedelta(hours=start_in_hours),
        end_date=now + timedelta(days=end_in_days) if end_in_days is not None else None,
        # Enablement + schedule live on the popup: a positive lead enables it.
        checkin_pass_lead_days=lead_days,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"buyer-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Buyer",
        last_name="Person",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_product(
    db: Session, tenant: Tenants, popup: Popups, *, requires_check_in: bool = True
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Pass Product {uuid.uuid4().hex[:6]}",
        slug=f"pass-prod-{uuid.uuid4().hex[:6]}",
        price=Decimal("25"),
        category="ticket",
        requires_check_in=requires_check_in,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    application: Applications,
    name: str = "Pass Attendee",
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        application_id=application.id,
        name=name,
        category="main",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_ticket(
    db: Session, tenant: Tenants, attendee: Attendees, product: Products
) -> AttendeeProducts:
    ticket = AttendeeProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=f"PASS{uuid.uuid4().hex[:6].upper()}",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


def _make_due_popup_with_tickets(
    db: Session, tenant: Tenants, *, n_tickets: int = 1, start_in_hours: float = 1.0
) -> tuple[Popups, Humans, list[AttendeeProducts]]:
    popup = _make_popup(db, tenant, start_in_hours=start_in_hours)
    human = _make_human(db, tenant)
    product = _make_product(db, tenant, popup, requires_check_in=True)
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    tickets = []
    for i in range(n_tickets):
        attendee = _make_attendee(db, tenant, popup, application, name=f"Attendee {i}")
        tickets.append(_make_ticket(db, tenant, attendee, product))
    return popup, human, tickets


def _mock_email_service() -> MagicMock:
    service = MagicMock()
    service.send_check_in_pass = AsyncMock(return_value=True)
    return service


def _run(db: Session) -> dict:
    return asyncio.run(dispatch_checkin_passes(db))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_dispatch_sends_to_buyer_marks_tickets_and_is_idempotent(
    db: Session, tenant_a: Tenants
) -> None:
    popup, human, tickets = _make_due_popup_with_tickets(db, tenant_a, n_tickets=2)
    email_service = _mock_email_service()

    with (
        patch(QR_TARGET, return_value="https://cdn.test/qr.png"),
        patch(EMAIL_TARGET, return_value=email_service),
    ):
        summary = _run(db)

    assert summary["status"] == "ok"
    assert summary["emails_sent"] == 1
    assert summary["tickets_marked"] == 2
    assert summary["failures"] == 0

    # One email to the buyer, carrying both QR codes.
    email_service.send_check_in_pass.assert_awaited_once()
    call = email_service.send_check_in_pass.await_args
    assert call.kwargs["to"] == human.email
    ctx = call.kwargs["context"]
    assert len(ctx.checkin_qrs) == 2
    assert ctx.checkin_qr_url == "https://cdn.test/qr.png"

    # Tickets are stamped.
    for ticket in tickets:
        db.refresh(ticket)
        assert ticket.checkin_pass_sent_at is not None

    # Second run sends nothing (idempotent).
    email_service2 = _mock_email_service()
    with (
        patch(QR_TARGET, return_value="https://cdn.test/qr.png"),
        patch(EMAIL_TARGET, return_value=email_service2),
    ):
        summary2 = _run(db)

    assert summary2["emails_sent"] == 0
    email_service2.send_check_in_pass.assert_not_awaited()


def test_dispatch_skips_popup_outside_window(db: Session, tenant_a: Tenants) -> None:
    # start far in the future; with a 3-day lead it's not yet within the window.
    _make_due_popup_with_tickets(db, tenant_a, n_tickets=1, start_in_hours=24 * 100)
    email_service = _mock_email_service()

    with (
        patch(QR_TARGET, return_value="https://cdn.test/qr.png"),
        patch(EMAIL_TARGET, return_value=email_service),
    ):
        summary = _run(db)

    assert summary["emails_sent"] == 0
    email_service.send_check_in_pass.assert_not_awaited()


def test_dispatch_sends_after_event_started(db: Session, tenant_a: Tenants) -> None:
    # start in the past (event already started), end still in the future ->
    # the dispatcher keeps sending so tickets purchased after the event begins
    # also get their QR. The window closes at end_date, not start_date.
    _make_due_popup_with_tickets(db, tenant_a, n_tickets=1, start_in_hours=-5)
    email_service = _mock_email_service()

    with (
        patch(QR_TARGET, return_value="https://cdn.test/qr.png"),
        patch(EMAIL_TARGET, return_value=email_service),
    ):
        summary = _run(db)

    assert summary["emails_sent"] == 1
    email_service.send_check_in_pass.assert_awaited_once()
