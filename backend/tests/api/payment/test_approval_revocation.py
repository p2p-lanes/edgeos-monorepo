"""Leaving APPROVED revokes what approval granted.

Revocation takes effect immediately through `revoked_at` while preserving
ProductUnit identity and history. Active holding queries must exclude revoked
rows even though the underlying records remain durable.

Scenarios:
- APPROVED -> CANCELLED revokes the rows that approval created.
- An admin-granted product (no payment) survives someone else's refund.
- Products from a DIFFERENT payment survive.
"""

import uuid
from decimal import Decimal

from sqlmodel import Session, select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, PaymentRecipients, Payments
from app.api.payment.schemas import PaymentStatus, PaymentType
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


def _make_product(
    db: Session,
    popup: Popups,
    category: str = "ticket",
) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Product {uuid.uuid4().hex[:6]}",
        slug=f"prod-{uuid.uuid4().hex[:8]}",
        price=Decimal("10"),
        category=category,
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
            select(AttendeeProducts).where(
                AttendeeProducts.attendee_id == attendee_id,
                AttendeeProducts.revoked_at.is_(None),  # type: ignore[union-attr]
            )
        ).all()
    )


def test_cancelling_an_approved_payment_revokes_its_holdings(
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
    """Revocation is keyed by payment_id, so a courtesy nobody paid for stays."""
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


def test_cancelling_mixed_payment_revokes_units_and_preserves_snapshots(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a)
    attendee = _make_attendee(db, popup)
    payment = Payments(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        status=PaymentStatus.APPROVED.value,
        amount=Decimal("40"),
    )
    db.add(payment)
    db.flush()
    recipient = PaymentRecipients(
        tenant_id=popup.tenant_id,
        payment_id=payment.id,
        recipient_key="typed-recipient",
        attendee_id=attendee.id,
        name=attendee.name,
    )
    db.add(recipient)
    db.flush()

    for category in ("ticket", "meal_plan", "parking", "merch"):
        product = _make_product(db, popup, category)
        line = PaymentProducts(
            tenant_id=popup.tenant_id,
            payment_id=payment.id,
            product_id=product.id,
            attendee_id=attendee.id,
            payment_recipient_id=(
                recipient.id if category in ("ticket", "meal_plan") else None
            ),
            product_name=product.name,
            product_price=product.price,
            product_category=product.category or "merch",
        )
        db.add(line)
        db.flush()
        holding = AttendeeProducts(
            tenant_id=popup.tenant_id,
            attendee_id=attendee.id,
            product_id=product.id,
            payment_id=payment.id,
            payment_product_id=line.id,
            unit_index=0,
            check_in_code=f"TYPE-{uuid.uuid4().hex[:8]}",
            product_category_snapshot=category,
        )
        db.add(holding)
    db.commit()

    payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)

    remaining = _holdings(db, attendee.id)
    assert remaining == []
    assert (
        len(
            db.exec(
                select(PaymentProducts).where(PaymentProducts.payment_id == payment.id)
            ).all()
        )
        == 4
    )
    assert db.get(PaymentRecipients, recipient.id) is not None
    assert db.get(Attendees, attendee.id) is not None


def test_cancelling_generic_line_preserves_snapshot_without_identity(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a)
    product = _make_product(db, popup, "merch")
    payment = Payments(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        status=PaymentStatus.APPROVED.value,
        amount=product.price,
    )
    db.add(payment)
    db.flush()
    line = PaymentProducts(
        tenant_id=popup.tenant_id,
        payment_id=payment.id,
        product_id=product.id,
        product_name=product.name,
        product_price=product.price,
        product_category=product.category or "merch",
    )
    db.add(line)
    db.commit()

    payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)

    assert db.get(PaymentProducts, line.id) is not None
    assert (
        db.exec(
            select(PaymentRecipients).where(PaymentRecipients.payment_id == payment.id)
        ).all()
        == []
    )
    assert (
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.payment_id == payment.id)
        ).all()
        == []
    )

    fee = Payments(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        payment_type=PaymentType.APPLICATION_FEE.value,
        status=PaymentStatus.APPROVED.value,
        amount=Decimal("10"),
    )
    db.add(fee)
    db.commit()

    payments_crud.update_status(db, fee.id, PaymentStatus.CANCELLED)

    assert db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all() == []
    assert (
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.payment_id == fee.id)
        ).all()
        == []
    )
