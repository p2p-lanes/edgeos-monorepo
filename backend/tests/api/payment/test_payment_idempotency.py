"""Idempotency tests for PaymentsCRUD.create_payment.

The endpoint that backs `POST /payments/my` previously had no guard against
double-submits, browser retries, or bfcache-induced replays. For $0 / fully
credited payments that auto-approve synchronously, each replay produced a
duplicate Payments row + a duplicate set of AttendeeProducts. These tests
pin the contract that a recent matching submission is short-circuited to
the existing payment instead.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import (
    PaymentCreate,
    PaymentProductRequest,
    PaymentStatus,
)
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name="Idempotency Test",
        slug=f"idem-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.application.value,
        status="active",
        simplefi_api_key="sf_test",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_free_product(db: Session, popup: Popups) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Free Pass {uuid.uuid4().hex[:6]}",
        slug=f"free-{uuid.uuid4().hex[:8]}",
        price=Decimal("0"),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.flush()
    return product


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"idem-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Idem",
        last_name="Tester",
    )
    db.add(human)
    db.flush()
    return human


def _make_app_and_attendee(
    db: Session, popup: Popups, human: Humans
) -> tuple[Applications, Attendees]:
    app = Applications(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(app)
    db.flush()
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        application_id=app.id,
        name="Idem Attendee",
        email=human.email,
        category="main",
    )
    db.add(attendee)
    db.flush()
    return app, attendee


def test_duplicate_submit_within_window_returns_existing_payment(
    db: Session, tenant_a: Tenants
) -> None:
    """Same payload, second time inside the dedup window → same Payment row."""
    popup = _make_popup(db, tenant_a)
    product = _make_free_product(db, popup)
    human = _make_human(db, tenant_a)
    app, attendee = _make_app_and_attendee(db, popup, human)
    db.commit()

    obj = PaymentCreate(
        application_id=app.id,
        products=[
            PaymentProductRequest(
                product_id=product.id,
                attendee_id=attendee.id,
                quantity=1,
            )
        ],
    )

    payment1, _ = payments_crud.create_payment(db, obj)
    payment2, _ = payments_crud.create_payment(db, obj)

    assert payment1.id == payment2.id, (
        "Second submit must return the existing Payment, not a duplicate."
    )

    payments = list(
        db.exec(select(Payments).where(Payments.application_id == app.id)).all()
    )
    assert len(payments) == 1, (
        f"Exactly one Payment should exist for the application, found {len(payments)}"
    )

    tickets = list(
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.attendee_id == attendee.id)
        ).all()
    )
    assert len(tickets) == 1, (
        f"Exactly one AttendeeProducts row should exist, found {len(tickets)}"
    )


def test_create_payment_persists_meta_attribution_for_my_payment_path(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a)
    product = _make_free_product(db, popup)
    human = _make_human(db, tenant_a)
    app, attendee = _make_app_and_attendee(db, popup, human)
    db.commit()

    obj = PaymentCreate(
        application_id=app.id,
        products=[
            PaymentProductRequest(
                product_id=product.id,
                attendee_id=attendee.id,
                quantity=1,
            )
        ],
    )

    payment, _ = payments_crud.create_payment(
        db,
        obj,
        attribution={
            "fbc": "fb.1.1710000000.click",
            "fbp": "fb.1.1710000000.browser",
            "client_ip": "203.0.113.10",
            "client_user_agent": "Mozilla/5.0 Test",
        },
    )

    assert payment.meta_fbc == "fb.1.1710000000.click"
    assert payment.meta_fbp == "fb.1.1710000000.browser"
    assert payment.meta_client_ip == "203.0.113.10"
    assert payment.meta_client_user_agent == "Mozilla/5.0 Test"


def test_different_products_within_window_creates_new_payment(
    db: Session, tenant_a: Tenants
) -> None:
    """Different product set → not a duplicate, new payment is created."""
    popup = _make_popup(db, tenant_a)
    product_a = _make_free_product(db, popup)
    product_b = _make_free_product(db, popup)
    human = _make_human(db, tenant_a)
    app, attendee = _make_app_and_attendee(db, popup, human)
    db.commit()

    obj_a = PaymentCreate(
        application_id=app.id,
        products=[
            PaymentProductRequest(
                product_id=product_a.id,
                attendee_id=attendee.id,
                quantity=1,
            )
        ],
    )
    obj_b = PaymentCreate(
        application_id=app.id,
        products=[
            PaymentProductRequest(
                product_id=product_b.id,
                attendee_id=attendee.id,
                quantity=1,
            )
        ],
    )

    payment1, _ = payments_crud.create_payment(db, obj_a)
    payment2, _ = payments_crud.create_payment(db, obj_b)

    assert payment1.id != payment2.id, (
        "Different products are a legitimate second purchase, not a duplicate."
    )


def test_old_approved_payment_outside_window_does_not_match(
    db: Session, tenant_a: Tenants
) -> None:
    """Existing matching payment older than the dedup window → new payment created."""
    popup = _make_popup(db, tenant_a)
    product = _make_free_product(db, popup)
    human = _make_human(db, tenant_a)
    app, attendee = _make_app_and_attendee(db, popup, human)
    db.commit()

    obj = PaymentCreate(
        application_id=app.id,
        products=[
            PaymentProductRequest(
                product_id=product.id,
                attendee_id=attendee.id,
                quantity=1,
            )
        ],
    )

    payment1, _ = payments_crud.create_payment(db, obj)

    # Backdate the first payment to put it outside the dedup window.
    payment1.created_at = datetime.now(tz=UTC) - timedelta(
        seconds=payments_crud._DUPLICATE_WINDOW_SECONDS + 60
    )
    db.add(payment1)
    db.commit()

    payment2, _ = payments_crud.create_payment(db, obj)

    assert payment2.id != payment1.id, (
        "A purchase outside the dedup window is treated as a new, legitimate "
        "purchase intent."
    )
    assert payment2.status == PaymentStatus.APPROVED.value
