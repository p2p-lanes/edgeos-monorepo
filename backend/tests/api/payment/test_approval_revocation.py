"""Leaving APPROVED revokes what approval granted.

Design D8 promises revocation takes effect immediately. Since
sdd/sales-flows-rediseno slice 5 access is read from `attendee_products`
rather than from payment status, so a cancelled payment that left its
holding rows behind would keep a refunded buyer inside upsale flows and any
`has_product` rule. `update_status` used to only ADD on approval; these
tests keep the other direction honest.

Scenarios:
- APPROVED -> CANCELLED removes the rows that approval created.
- An admin-granted product (no payment) survives someone else's refund.
- Products from a DIFFERENT payment survive.
"""

import uuid
from decimal import Decimal

from sqlmodel import Session, select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from tests._flow_helpers import provision_default_flow


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Revocation Popup {uuid.uuid4().hex[:6]}",
        slug=f"revoke-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup)
    return popup


def _make_attendee(db: Session, popup: Popups) -> Attendees:
    human = Humans(
        tenant_id=popup.tenant_id,
        email=f"revoke-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.flush()
    attendee = Attendees(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        name="Revocation Attendee",
        email=human.email,
        category="main",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_product(db: Session, popup: Popups) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Product {uuid.uuid4().hex[:6]}",
        slug=f"prod-{uuid.uuid4().hex[:8]}",
        price=Decimal("10"),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _approved_payment_with_holding(
    db: Session, popup: Popups, attendee: Attendees, product: Products
) -> Payments:
    payment = Payments(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        status=PaymentStatus.APPROVED.value,
        amount=product.price,
    )
    db.add(payment)
    db.flush()
    db.add(
        PaymentProducts(
            tenant_id=popup.tenant_id,
            payment_id=payment.id,
            product_id=product.id,
            attendee_id=attendee.id,
            product_name=product.name,
            product_price=product.price,
            product_category=product.category,
        )
    )
    db.add(
        AttendeeProducts(
            tenant_id=popup.tenant_id,
            attendee_id=attendee.id,
            product_id=product.id,
            payment_id=payment.id,
            check_in_code=uuid.uuid4().hex[:10],
        )
    )
    db.commit()
    db.refresh(payment)
    return payment


def _holdings(db: Session, attendee_id: uuid.UUID) -> list[AttendeeProducts]:
    return list(
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.attendee_id == attendee_id)
        ).all()
    )


def test_cancelling_an_approved_payment_removes_its_holdings(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a)
    attendee = _make_attendee(db, popup)
    product = _make_product(db, popup)
    payment = _approved_payment_with_holding(db, popup, attendee, product)
    assert len(_holdings(db, attendee.id)) == 1

    payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)

    assert _holdings(db, attendee.id) == []


def test_an_admin_granted_product_survives_a_refund(
    db: Session, tenant_a: Tenants
) -> None:
    """Removal is keyed by payment_id, so a courtesy nobody paid for stays."""
    popup = _make_popup(db, tenant_a)
    attendee = _make_attendee(db, popup)
    paid_product = _make_product(db, popup)
    granted_product = _make_product(db, popup)
    payment = _approved_payment_with_holding(db, popup, attendee, paid_product)
    db.add(
        AttendeeProducts(
            tenant_id=popup.tenant_id,
            attendee_id=attendee.id,
            product_id=granted_product.id,
            payment_id=None,
            check_in_code=uuid.uuid4().hex[:10],
        )
    )
    db.commit()

    payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)

    remaining = _holdings(db, attendee.id)
    assert [h.product_id for h in remaining] == [granted_product.id]


def test_another_payments_products_survive(db: Session, tenant_a: Tenants) -> None:
    popup = _make_popup(db, tenant_a)
    attendee = _make_attendee(db, popup)
    first_product = _make_product(db, popup)
    second_product = _make_product(db, popup)
    first = _approved_payment_with_holding(db, popup, attendee, first_product)
    _approved_payment_with_holding(db, popup, attendee, second_product)

    payments_crud.update_status(db, first.id, PaymentStatus.CANCELLED)

    remaining = _holdings(db, attendee.id)
    assert [h.product_id for h in remaining] == [second_product.id]
