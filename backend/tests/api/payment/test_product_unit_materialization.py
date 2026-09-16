"""Focused coverage for approval-time operational product units."""

import uuid
from decimal import Decimal
from types import SimpleNamespace

from sqlmodel import Session, select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.payment.crud import _classify_product_unit, payments_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants


def _product(
    db: Session,
    popup: Popups,
    *,
    category: str,
    requires_check_in: bool,
) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Unit product {uuid.uuid4().hex[:6]}",
        slug=f"unit-product-{uuid.uuid4().hex[:8]}",
        price=Decimal("10"),
        category=category,
        requires_check_in=requires_check_in,
        is_active=True,
    )
    db.add(product)
    db.flush()
    return product


def _purchase(
    db: Session,
    popup: Popups,
    product: Products,
    *,
    quantity: int,
    attendee: Attendees | None = None,
) -> tuple[Payments, PaymentProducts]:
    payment = Payments(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        status=PaymentStatus.PENDING.value,
        amount=product.price * quantity,
    )
    db.add(payment)
    db.flush()
    line = PaymentProducts(
        tenant_id=popup.tenant_id,
        payment_id=payment.id,
        product_id=product.id,
        attendee_id=attendee.id if attendee else None,
        quantity=quantity,
        product_name=product.name,
        product_price=product.price,
        product_category=product.category or "",
        requires_check_in_snapshot=product.requires_check_in,
    )
    db.add(line)
    db.commit()
    return payment, line


def _units(db: Session, payment: Payments) -> list[AttendeeProducts]:
    return list(
        db.exec(
            select(AttendeeProducts)
            .where(AttendeeProducts.payment_id == payment.id)
            .order_by(AttendeeProducts.unit_index)
        ).all()
    )


def _attendee_count(db: Session, popup: Popups) -> int:
    return len(
        db.exec(select(Attendees.id).where(Attendees.popup_id == popup.id)).all()
    )


def test_classifier_separates_ticket_parking_and_generic_products() -> None:
    assert (
        _classify_product_unit(
            SimpleNamespace(product_category="ticket", requires_check_in_snapshot=False)
        )
        == "attendee"
    )
    assert (
        _classify_product_unit(
            SimpleNamespace(product_category="parking", requires_check_in_snapshot=True)
        )
        == "ownerless"
    )
    assert (
        _classify_product_unit(
            SimpleNamespace(product_category="merch", requires_check_in_snapshot=False)
        )
        is None
    )


def test_approved_parking_materializes_stable_ownerless_snapshots(
    db: Session, popup_tenant_a: Popups
) -> None:
    product = _product(
        db,
        popup_tenant_a,
        category="parking",
        requires_check_in=True,
    )
    attendee_count = _attendee_count(db, popup_tenant_a)
    payment, line = _purchase(db, popup_tenant_a, product, quantity=3)
    product.category = "merch"
    product.requires_check_in = False
    db.commit()

    payments_crud.approve_payment(db, payment.id)
    units = _units(db, payment)
    identity = [(unit.id, unit.check_in_code, unit.unit_index) for unit in units]

    assert [unit.unit_index for unit in units] == [0, 1, 2]
    assert len({unit.check_in_code for unit in units}) == 3
    assert all(unit.attendee_id is None for unit in units)
    assert all(unit.payment_product_id == line.id for unit in units)
    assert all(unit.product_category_snapshot == "parking" for unit in units)
    assert all(unit.requires_check_in_snapshot is True for unit in units)
    assert _attendee_count(db, popup_tenant_a) == attendee_count

    payments_crud.approve_payment(db, payment.id)
    assert [
        (unit.id, unit.check_in_code, unit.unit_index) for unit in _units(db, payment)
    ] == identity


def test_generic_product_creates_no_units(db: Session, popup_tenant_a: Popups) -> None:
    product = _product(
        db,
        popup_tenant_a,
        category="merch",
        requires_check_in=False,
    )
    payment, _ = _purchase(db, popup_tenant_a, product, quantity=2)

    payments_crud.approve_payment(db, payment.id)

    assert _units(db, payment) == []


def test_existing_ticket_materialization_remains_attendee_compatible(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    attendee = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        name="Existing ticket attendee",
    )
    db.add(attendee)
    db.flush()
    product = _product(
        db,
        popup_tenant_a,
        category="ticket",
        requires_check_in=True,
    )
    payment, line = _purchase(
        db, popup_tenant_a, product, quantity=2, attendee=attendee
    )

    payments_crud.approve_payment(db, payment.id)
    units = _units(db, payment)

    assert [unit.unit_index for unit in units] == [0, 1]
    assert all(unit.attendee_id == attendee.id for unit in units)
    assert all(unit.payment_product_id == line.id for unit in units)
    assert all(unit.product_category_snapshot == "ticket" for unit in units)
    assert all(unit.requires_check_in_snapshot is True for unit in units)
