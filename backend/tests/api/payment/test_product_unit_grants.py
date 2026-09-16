"""Focused cardinality and paymentless ProductUnit grant coverage."""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, func, select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.audit_log.constants import AuditAction
from app.api.audit_log.models import AuditLog
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants


def _product(
    db: Session,
    popup: Popups,
    *,
    category: str = "ticket",
    stock: int = 20,
) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"WU5 {category} {uuid.uuid4().hex[:6]}",
        slug=f"wu5-{category}-{uuid.uuid4().hex[:8]}",
        price=Decimal("10"),
        category=category,
        requires_check_in=True,
        is_active=True,
        total_stock_cap=stock,
        total_stock_remaining=stock,
    )
    db.add(product)
    db.flush()
    return product


def _attendee(db: Session, tenant: Tenants, popup: Popups) -> tuple[Humans, Attendees]:
    human = Humans(
        tenant_id=tenant.id,
        email=f"wu5-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.flush()
    attendee = Attendees(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        name="WU5 attendee",
    )
    db.add(attendee)
    db.flush()
    return human, attendee


def _line(
    db: Session,
    payment: Payments,
    product: Products,
    quantity: int,
    attendee: Attendees | None = None,
) -> PaymentProducts:
    line = PaymentProducts(
        tenant_id=payment.tenant_id,
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
    db.flush()
    return line


def _line_units(db: Session, line: PaymentProducts) -> list[AttendeeProducts]:
    return list(
        db.exec(
            select(AttendeeProducts)
            .where(AttendeeProducts.payment_product_id == line.id)
            .order_by(AttendeeProducts.unit_index)
        ).all()
    )


def test_paid_quantity_reconciles_partial_units_and_replays_stably(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer, attendee = _attendee(db, tenant_a, popup_tenant_a)
    ticket = _product(db, popup_tenant_a)
    parking = _product(db, popup_tenant_a, category="parking")
    payment = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        buyer_human_id=buyer.id,
        status=PaymentStatus.PENDING.value,
        amount=Decimal("50"),
    )
    db.add(payment)
    db.flush()
    ticket_line = _line(db, payment, ticket, 3, attendee)
    parking_line = _line(db, payment, parking, 2)
    existing = AttendeeProducts(
        tenant_id=tenant_a.id,
        attendee_id=attendee.id,
        product_id=ticket.id,
        payment_id=payment.id,
        payment_product_id=ticket_line.id,
        unit_index=1,
        check_in_code="WU5STABLE",
        product_category_snapshot="ticket",
        requires_check_in_snapshot=True,
    )
    db.add(existing)
    db.commit()

    payments_crud.approve_payment(db, payment.id)
    ticket_units = _line_units(db, ticket_line)
    parking_units = _line_units(db, parking_line)
    stable = {
        unit.id: (unit.check_in_code, unit.attendee_id, unit.unit_index)
        for unit in ticket_units + parking_units
    }

    assert [unit.unit_index for unit in ticket_units] == [0, 1, 2]
    assert {unit.attendee_id for unit in ticket_units} == {attendee.id}
    assert ticket_units[1].id == existing.id
    assert ticket_units[1].check_in_code == "WU5STABLE"
    assert [unit.unit_index for unit in parking_units] == [0, 1]
    assert {unit.attendee_id for unit in parking_units} == {None}

    payments_crud.approve_payment(db, payment.id)
    replayed = _line_units(db, ticket_line) + _line_units(db, parking_line)
    assert {
        unit.id: (unit.check_in_code, unit.attendee_id, unit.unit_index)
        for unit in replayed
    } == stable


def test_paymentless_grant_replay_preserves_units_stock_and_audit(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    _, attendee = _attendee(db, tenant_a, popup_tenant_a)
    product = _product(db, popup_tenant_a, stock=5)
    db.commit()
    attendee_count = db.exec(select(func.count()).select_from(Attendees)).one()
    payment_count = db.exec(select(func.count()).select_from(Payments)).one()
    headers = {
        "Authorization": f"Bearer {admin_token_tenant_a}",
        "X-Request-ID": f"wu5-grant-{uuid.uuid4().hex}",
    }
    payload = {"items": [{"product_id": str(product.id), "quantity": 2}]}

    first = client.post(
        f"/api/v1/attendees/{attendee.id}/tickets", json=payload, headers=headers
    )
    assert first.status_code == 201, first.text
    units = list(
        db.exec(
            select(AttendeeProducts)
            .where(
                AttendeeProducts.attendee_id == attendee.id,
                AttendeeProducts.product_id == product.id,
            )
            .order_by(AttendeeProducts.id)
        ).all()
    )
    identity = [(unit.id, unit.check_in_code) for unit in units]

    second = client.post(
        f"/api/v1/attendees/{attendee.id}/tickets", json=payload, headers=headers
    )
    assert second.status_code == 201, second.text
    replayed = list(
        db.exec(
            select(AttendeeProducts)
            .where(
                AttendeeProducts.attendee_id == attendee.id,
                AttendeeProducts.product_id == product.id,
            )
            .order_by(AttendeeProducts.id)
        ).all()
    )

    assert [(unit.id, unit.check_in_code) for unit in replayed] == identity
    assert len(replayed) == 2
    assert {
        (unit.payment_id, unit.payment_product_id, unit.unit_index) for unit in replayed
    } == {(None, None, None)}
    assert {unit.product_category_snapshot for unit in replayed} == {"ticket"}
    assert {unit.requires_check_in_snapshot for unit in replayed} == {True}
    db.refresh(product)
    assert product.total_stock_remaining == 3
    assert db.exec(select(func.count()).select_from(Attendees)).one() == attendee_count
    assert db.exec(select(func.count()).select_from(Payments)).one() == payment_count
    assert (
        db.exec(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.entity_id == attendee.id,
                AuditLog.action == AuditAction.TICKET_ADD,
            )
        ).one()
        == 1
    )


def test_paymentless_grant_does_not_collide_with_paid_lineage(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    buyer, attendee = _attendee(db, tenant_a, popup_tenant_a)
    product = _product(db, popup_tenant_a)
    db.commit()
    response = client.post(
        f"/api/v1/attendees/{attendee.id}/tickets",
        json={"items": [{"product_id": str(product.id), "quantity": 1}]},
        headers={
            "Authorization": f"Bearer {admin_token_tenant_a}",
            "X-Request-ID": f"wu5-collision-{uuid.uuid4().hex}",
        },
    )
    assert response.status_code == 201, response.text
    granted = db.exec(
        select(AttendeeProducts).where(
            AttendeeProducts.attendee_id == attendee.id,
            AttendeeProducts.product_id == product.id,
            AttendeeProducts.payment_id.is_(None),  # type: ignore[union-attr]
        )
    ).one()

    payment = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        buyer_human_id=buyer.id,
        status=PaymentStatus.PENDING.value,
        amount=Decimal("20"),
    )
    db.add(payment)
    db.flush()
    line = _line(db, payment, product, 2, attendee)
    db.commit()

    payments_crud.approve_payment(db, payment.id)
    db.refresh(granted)
    paid = _line_units(db, line)

    assert (granted.payment_product_id, granted.unit_index) == (None, None)
    assert [unit.unit_index for unit in paid] == [0, 1]
    assert {unit.attendee_id for unit in paid} == {attendee.id}
    assert granted.id not in {unit.id for unit in paid}
