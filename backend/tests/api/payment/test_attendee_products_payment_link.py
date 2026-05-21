"""Regression: AttendeeProducts.payment_id is set when tickets are created
via the approval paths (approve_payment, update_status -> APPROVED).

Background: the `ticket-as-first-class-entity` refactor added an optional
`payment_id` kwarg to PaymentsCRUD._add_products_to_attendees. The three
call sites must forward it so tickets are linked back to their originating
payment. A regression in May 2026 left production rows with payment_id=NULL,
breaking refund / cancellation cleanup, profile stats, and product snapshots.
"""

import uuid
from decimal import Decimal

from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentProductRequest, PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants


def _make_product(db: Session, tenant: Tenants, popup: Popups) -> Products:
    suffix = uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"link-test-{suffix}",
        slug=f"link-{suffix}",
        price=Decimal("100"),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.flush()
    return product


def _make_pending_payment_with_snapshot(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    product_qty_pairs: list[tuple[Products, int]],
) -> tuple[Payments, Attendees]:
    """Build a PENDING payment with PaymentProducts snapshot rows + 1 attendee."""
    human = Humans(
        tenant_id=tenant.id,
        email=f"link-human-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Link",
        last_name="Test",
    )
    db.add(human)
    db.flush()

    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()

    attendee = Attendees(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        name="Link Attendee",
        category="main",
        email=f"att-{uuid.uuid4().hex[:8]}@test.com",
        check_in_code=f"L{uuid.uuid4().hex[:4].upper()}",
    )
    db.add(attendee)
    db.flush()

    payment = Payments(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status=PaymentStatus.PENDING.value,
        amount=Decimal("100"),
        currency="USD",
        external_id=f"sf-link-{uuid.uuid4().hex[:12]}",
    )
    db.add(payment)
    db.flush()

    for product, qty in product_qty_pairs:
        db.add(
            PaymentProducts(
                tenant_id=tenant.id,
                payment_id=payment.id,
                product_id=product.id,
                attendee_id=attendee.id,
                quantity=qty,
                product_name=product.name,
                product_description=None,
                product_price=product.price,
                product_category=product.category or "ticket",
                product_currency="USD",
            )
        )

    db.commit()
    db.refresh(payment)
    return payment, attendee


def test_approve_payment_links_tickets_to_payment(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """approve_payment must set AttendeeProducts.payment_id on every new ticket."""
    product = _make_product(db, tenant_a, popup_tenant_a)
    payment, attendee = _make_pending_payment_with_snapshot(
        db, tenant_a, popup_tenant_a, [(product, 2)]
    )

    payments_crud.approve_payment(db, payment.id)

    db.expire_all()
    tickets = list(
        db.exec(
            select(AttendeeProducts).where(
                AttendeeProducts.attendee_id == attendee.id,
                AttendeeProducts.product_id == product.id,
            )
        ).all()
    )
    assert len(tickets) == 2
    assert all(t.payment_id == payment.id for t in tickets), (
        "approve_payment must link every new AttendeeProducts row to the "
        "payment that approved it."
    )


def test_update_status_to_approved_links_tickets_to_payment(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """update_status -> APPROVED must set AttendeeProducts.payment_id on every new ticket."""
    product = _make_product(db, tenant_a, popup_tenant_a)
    payment, attendee = _make_pending_payment_with_snapshot(
        db, tenant_a, popup_tenant_a, [(product, 3)]
    )

    payments_crud.update_status(db, payment.id, PaymentStatus.APPROVED)

    db.expire_all()
    tickets = list(
        db.exec(
            select(AttendeeProducts).where(
                AttendeeProducts.attendee_id == attendee.id,
                AttendeeProducts.product_id == product.id,
            )
        ).all()
    )
    assert len(tickets) == 3
    assert all(t.payment_id == payment.id for t in tickets), (
        "update_status -> APPROVED must link every new AttendeeProducts row "
        "to the payment whose status transitioned."
    )


def test_add_products_to_attendees_forwards_payment_id(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """_add_products_to_attendees stamps payment_id when the kwarg is provided.

    Direct contract test that backs up the auto-approve branch of
    create_payment, which constructs the Payments row, flushes it, and then
    calls this method with payment_id=payment.id.
    """
    product = _make_product(db, tenant_a, popup_tenant_a)
    payment, attendee = _make_pending_payment_with_snapshot(
        db, tenant_a, popup_tenant_a, [(product, 1)]
    )

    payments_crud._add_products_to_attendees(
        db,
        [
            PaymentProductRequest(
                product_id=product.id,
                attendee_id=attendee.id,
                quantity=2,
            )
        ],
        payment_id=payment.id,
    )
    db.commit()

    db.expire_all()
    tickets = list(
        db.exec(
            select(AttendeeProducts).where(
                AttendeeProducts.attendee_id == attendee.id,
                AttendeeProducts.product_id == product.id,
            )
        ).all()
    )
    assert len(tickets) == 2
    assert all(t.payment_id == payment.id for t in tickets)
