"""Integration tests for the reminder dispatch job.

Invokes ``dispatch_reminders`` directly — the job runs as a standalone module
from a scheduler, so the tests exercise the service entrypoint rather than
going through FastAPI.

Unlike the check-in dispatch tests, these do NOT mock the email service:
idempotency depends on the real send path writing ``email_logs`` (in its
isolated session) and the job reading those rows back through
``get_reminder_stats``. Only SMTP delivery (``EmailService._deliver_smtp``)
is mocked, so rendering, logging and cadence all run for real.

Coverage:
- purchase reminder: first send after N days, idempotent rerun, repeat after
  M days, capped at K, and buyers with an approved payment excluded
- abandoned application: draft anchored on updated_at, single send when no
  repeat interval is configured
- abandoned cart: non-completed payment, prices recomputed from the current
  product, buyers who completed a purchase excluded
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch

from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.email_log.models import EmailLogs
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.services.reminder_dispatch import dispatch_reminders

DELIVER_TARGET = "app.services.email.service.EmailService._deliver_smtp"
ENGINE_TARGET = "app.core.db.engine"

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants, **reminder_config) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Reminder Popup {uuid.uuid4().hex[:6]}",
        slug=f"reminder-{uuid.uuid4().hex[:8]}",
        **reminder_config,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"reminder-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Reminder",
        last_name="Target",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    status: ApplicationStatus,
    accepted_days_ago: float | None = None,
    updated_days_ago: float = 0,
    now: datetime,
) -> Applications:
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=status.value,
        accepted_at=(
            now - timedelta(days=accepted_days_ago)
            if accepted_days_ago is not None
            else None
        ),
        updated_at=now - timedelta(days=updated_days_ago),
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _make_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    application: Applications,
    *,
    status: PaymentStatus,
    created_days_ago: float,
    now: datetime,
    amount: str = "50",
) -> Payments:
    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        application_id=application.id,
        status=status.value,
        amount=Decimal(amount),
        currency="USD",
        created_at=now - timedelta(days=created_days_ago),
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _make_snapshot_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    application: Applications,
    payment: Payments,
    *,
    snapshot_price: str,
    current_price: str,
    quantity: int = 1,
) -> Products:
    """Attach a product snapshot to a payment, with a live product whose
    current price differs from the snapshot."""
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Reminder Product {uuid.uuid4().hex[:6]}",
        slug=f"reminder-prod-{uuid.uuid4().hex[:6]}",
        price=Decimal(current_price),
        category="ticket",
    )
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        application_id=application.id,
        name="Reminder Attendee",
        category="main",
    )
    db.add(product)
    db.add(attendee)
    db.commit()
    snapshot = PaymentProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        payment_id=payment.id,
        product_id=product.id,
        attendee_id=attendee.id,
        quantity=quantity,
        product_name=product.name,
        product_price=Decimal(snapshot_price),
        product_category="ticket",
        product_currency="USD",
    )
    db.add(snapshot)
    db.commit()
    return product


def _run(db: Session, test_engine, *, now: datetime) -> tuple[dict, AsyncMock]:
    """Run one dispatch with SMTP mocked and the log engine redirected."""
    deliver = AsyncMock(return_value=(True, None))
    with (
        patch(DELIVER_TARGET, deliver),
        patch(ENGINE_TARGET, test_engine),
    ):
        summary = asyncio.run(dispatch_reminders(db, now=now))
    return summary, deliver


def _log_rows(db: Session, popup: Popups, template_type: str) -> list[EmailLogs]:
    return list(
        db.exec(
            select(EmailLogs).where(
                EmailLogs.popup_id == popup.id,
                EmailLogs.template_type == template_type,
            )
        ).all()
    )


def _sent_to(deliver: AsyncMock, email: str) -> int:
    return sum(1 for c in deliver.await_args_list if c.kwargs["to"] == email)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_purchase_reminder_cadence_and_paid_exclusion(
    db: Session, test_engine, tenant_a: Tenants
) -> None:
    now = datetime.now(UTC)
    popup = _make_popup(
        db,
        tenant_a,
        purchase_reminder_delay_days=3,
        purchase_reminder_repeat_days=2,
        purchase_reminder_max_count=2,
    )
    unpaid_human = _make_human(db, tenant_a)
    unpaid_app = _make_application(
        db,
        tenant_a,
        popup,
        unpaid_human,
        status=ApplicationStatus.ACCEPTED,
        accepted_days_ago=5,
        now=now,
    )
    # Accepted applicant who already purchased: must never be reminded.
    paid_human = _make_human(db, tenant_a)
    paid_app = _make_application(
        db,
        tenant_a,
        popup,
        paid_human,
        status=ApplicationStatus.ACCEPTED,
        accepted_days_ago=5,
        now=now,
    )
    _make_payment(
        db,
        tenant_a,
        popup,
        paid_app,
        status=PaymentStatus.APPROVED,
        created_days_ago=4,
        now=now,
    )

    # First run: only the unpaid applicant is due.
    _, deliver = _run(db, test_engine, now=now)
    assert _sent_to(deliver, unpaid_human.email) == 1
    assert _sent_to(deliver, paid_human.email) == 0
    logs = _log_rows(db, popup, "purchase_reminder")
    assert len(logs) == 1
    assert logs[0].application_id == unpaid_app.id
    assert logs[0].to_email == unpaid_human.email
    assert logs[0].status == "sent"

    # Immediate rerun: nothing new (idempotent — the log is the memory).
    _, deliver = _run(db, test_engine, now=now)
    assert _sent_to(deliver, unpaid_human.email) == 0

    # Three days later the repeat interval (2d) has elapsed: second send.
    _, deliver = _run(db, test_engine, now=now + timedelta(days=3))
    assert _sent_to(deliver, unpaid_human.email) == 1
    assert len(_log_rows(db, popup, "purchase_reminder")) == 2

    # Much later: the cap (max 2) blocks any further sends.
    _, deliver = _run(db, test_engine, now=now + timedelta(days=30))
    assert _sent_to(deliver, unpaid_human.email) == 0
    assert len(_log_rows(db, popup, "purchase_reminder")) == 2


def test_abandoned_application_anchor_and_single_send(
    db: Session, test_engine, tenant_a: Tenants
) -> None:
    now = datetime.now(UTC)
    popup = _make_popup(db, tenant_a, abandoned_application_delay_days=4)
    stale_human = _make_human(db, tenant_a)
    stale_app = _make_application(
        db,
        tenant_a,
        popup,
        stale_human,
        status=ApplicationStatus.DRAFT,
        updated_days_ago=6,
        now=now,
    )
    # Recently edited draft: still active, not abandoned.
    fresh_human = _make_human(db, tenant_a)
    _make_application(
        db,
        tenant_a,
        popup,
        fresh_human,
        status=ApplicationStatus.DRAFT,
        updated_days_ago=1,
        now=now,
    )

    _, deliver = _run(db, test_engine, now=now)
    assert _sent_to(deliver, stale_human.email) == 1
    assert _sent_to(deliver, fresh_human.email) == 0
    logs = _log_rows(db, popup, "abandoned_application")
    assert len(logs) == 1
    assert logs[0].application_id == stale_app.id

    # No repeat interval configured: the stale draft gets one send total,
    # ever. Meanwhile the other draft, now 31 days old, has legitimately
    # become abandoned and receives its own first send.
    _, deliver = _run(db, test_engine, now=now + timedelta(days=30))
    assert _sent_to(deliver, stale_human.email) == 0
    assert _sent_to(deliver, fresh_human.email) == 1
    stale_logs = [
        log
        for log in _log_rows(db, popup, "abandoned_application")
        if log.application_id == stale_app.id
    ]
    assert len(stale_logs) == 1


def test_abandoned_cart_recomputes_price_and_excludes_paid(
    db: Session, test_engine, tenant_a: Tenants
) -> None:
    now = datetime.now(UTC)
    popup = _make_popup(db, tenant_a, abandoned_cart_delay_days=2)
    buyer = _make_human(db, tenant_a)
    application = _make_application(
        db,
        tenant_a,
        popup,
        buyer,
        status=ApplicationStatus.ACCEPTED,
        accepted_days_ago=10,
        now=now,
    )
    abandoned = _make_payment(
        db,
        tenant_a,
        popup,
        application,
        status=PaymentStatus.EXPIRED,
        created_days_ago=3,
        now=now,
    )
    # Snapshot says 25 but the product now costs 30: the email must quote the
    # current price (2 x 30 = 60.00).
    _make_snapshot_product(
        db,
        tenant_a,
        popup,
        application,
        abandoned,
        snapshot_price="25",
        current_price="30",
        quantity=2,
    )
    # A buyer who abandoned one payment but completed another: excluded.
    paid_buyer = _make_human(db, tenant_a)
    paid_app = _make_application(
        db,
        tenant_a,
        popup,
        paid_buyer,
        status=ApplicationStatus.ACCEPTED,
        accepted_days_ago=10,
        now=now,
    )
    _make_payment(
        db,
        tenant_a,
        popup,
        paid_app,
        status=PaymentStatus.EXPIRED,
        created_days_ago=3,
        now=now,
    )
    _make_payment(
        db,
        tenant_a,
        popup,
        paid_app,
        status=PaymentStatus.APPROVED,
        created_days_ago=1,
        now=now,
    )

    _, deliver = _run(db, test_engine, now=now)
    assert _sent_to(deliver, buyer.email) == 1
    assert _sent_to(deliver, paid_buyer.email) == 0
    sent_call = next(
        c for c in deliver.await_args_list if c.kwargs["to"] == buyer.email
    )
    assert "60.00" in sent_call.kwargs["html_content"]
    logs = _log_rows(db, popup, "abandoned_cart")
    assert len(logs) == 1
    assert logs[0].payment_id == abandoned.id
    assert logs[0].to_email == buyer.email

    # Rerun: the log remembers the send, nothing goes out again.
    _, deliver = _run(db, test_engine, now=now)
    assert _sent_to(deliver, buyer.email) == 0
    assert len(_log_rows(db, popup, "abandoned_cart")) == 1


def test_reminders_use_tenant_sender(db: Session, test_engine) -> None:
    """Every reminder leaves from the tenant's own sender, not the platform's."""
    now = datetime.now(UTC)
    suffix = uuid.uuid4().hex[:8]
    tenant = Tenants(
        name=f"Sender Tenant {suffix}",
        slug=f"sender-tenant-{suffix}",
        sender_email=f"hello-{suffix}@tenant.example",
        sender_name="Tenant Sender",
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    popup = _make_popup(
        db,
        tenant,
        purchase_reminder_delay_days=3,
        abandoned_application_delay_days=4,
    )
    accepted_human = _make_human(db, tenant)
    _make_application(
        db,
        tenant,
        popup,
        accepted_human,
        status=ApplicationStatus.ACCEPTED,
        accepted_days_ago=5,
        now=now,
    )
    draft_human = _make_human(db, tenant)
    _make_application(
        db,
        tenant,
        popup,
        draft_human,
        status=ApplicationStatus.DRAFT,
        updated_days_ago=6,
        now=now,
    )

    _, deliver = _run(db, test_engine, now=now)
    recipients = {accepted_human.email, draft_human.email}
    calls = [c for c in deliver.await_args_list if c.kwargs["to"] in recipients]
    assert len(calls) == 2
    for call in calls:
        assert call.kwargs["from_address"] == tenant.sender_email
        assert call.kwargs["from_name"] == tenant.sender_name
