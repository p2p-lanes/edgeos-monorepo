"""Focused ProductUnit revocation and exact-once stock lifecycle coverage."""

import uuid
from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from sqlmodel import Session, func, select

from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.audit_log.actor import AuditActor, AuditActorType, AuditSource
from app.api.audit_log.constants import AuditAction
from app.api.audit_log.models import AuditLog
from app.api.check_in.models import CheckIn
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.crud import products_crud
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from tests.api.payment import test_product_unit_grants as grants


def _pending_payment(
    db: Session,
    popup: Popups,
    buyer: Humans,
    attendee: Attendees,
    product: Products,
    quantity: int,
) -> tuple[Payments, PaymentProducts]:
    payment = Payments(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        buyer_human_id=buyer.id,
        status=PaymentStatus.PENDING.value,
        amount=product.price * quantity,
    )
    db.add(payment)
    db.flush()
    line = grants._line(db, payment, product, quantity, attendee)
    products_crud.decrement_total_stock(db, product.id, quantity)
    db.commit()
    return payment, line


def _scan(db: Session, popup: Popups, unit: AttendeeProducts) -> CheckIn:
    event = CheckIn(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        attendee_product_id=unit.id,
    )
    db.add(event)
    db.commit()
    return event


def test_cancel_replays_preserve_history_and_restore_commercial_quantity(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer, attendee = grants._attendee(db, tenant_a, popup_tenant_a)
    product = grants._product(db, popup_tenant_a, stock=12)
    target, target_line = _pending_payment(
        db, popup_tenant_a, buyer, attendee, product, 3
    )
    payments_crud.approve_payment(db, target.id)
    target_units = grants._line_units(db, target_line)
    with pytest.raises(HTTPException) as exc_info:
        attendees_crud.remove_product(db, attendee.id, target_units[1].id)
    assert exc_info.value.status_code == 409
    scanned = _scan(db, popup_tenant_a, target_units[0])
    db.delete(target_units[2])  # A partial unit set must not reduce stock restoration.
    db.commit()
    attendees_crud.add_products(
        db,
        attendee.id,
        [(product.id, 1)],
        actor=AuditActor(type=AuditActorType.SYSTEM, source=AuditSource.SYSTEM),
        grant_key=f"wu6-grant-{uuid.uuid4().hex}",
    )
    grant = db.exec(
        select(AttendeeProducts).where(
            AttendeeProducts.attendee_id == attendee.id,
            AttendeeProducts.product_id == product.id,
            AttendeeProducts.payment_id.is_(None),  # type: ignore[union-attr]
        )
    ).one()
    other, other_line = _pending_payment(
        db, popup_tenant_a, buyer, attendee, product, 2
    )
    payments_crud.approve_payment(db, other.id)
    db.refresh(product)
    assert product.total_stock_remaining == 6
    preserved = {
        unit.id: (unit.check_in_code, unit.payment_product_id, unit.unit_index)
        for unit in grants._line_units(db, target_line)
    }

    payments_crud.update_status(db, target.id, PaymentStatus.CANCELLED)
    cancelled = grants._line_units(db, target_line)
    first_revocation = {unit.id: unit.revoked_at for unit in cancelled}
    db.refresh(product)

    assert {
        unit.id: (unit.check_in_code, unit.payment_product_id, unit.unit_index)
        for unit in cancelled
    } == preserved
    assert len(cancelled) == 2
    assert all(revoked_at is not None for revoked_at in first_revocation.values())
    assert db.get(CheckIn, scanned.id).attendee_product_id == cancelled[0].id
    assert db.get(PaymentProducts, target_line.id) is not None
    assert product.total_stock_remaining == 9
    assert db.get(AttendeeProducts, grant.id).revoked_at is None
    assert all(unit.revoked_at is None for unit in grants._line_units(db, other_line))

    payments_crud.update_status(db, target.id, PaymentStatus.CANCELLED)
    db.refresh(product)
    assert product.total_stock_remaining == 9
    assert {
        unit.id: unit.revoked_at for unit in grants._line_units(db, target_line)
    } == first_revocation


def test_reject_pending_revokes_partial_units_and_restores_stock_once(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer, attendee = grants._attendee(db, tenant_a, popup_tenant_a)
    product = grants._product(db, popup_tenant_a, stock=6)
    payment, line = _pending_payment(db, popup_tenant_a, buyer, attendee, product, 2)
    unit = AttendeeProducts(
        tenant_id=tenant_a.id,
        attendee_id=attendee.id,
        product_id=product.id,
        payment_id=payment.id,
        payment_product_id=line.id,
        unit_index=0,
        check_in_code="WU6PARTIAL",
    )
    db.add(unit)
    db.commit()

    payments_crud.update_status(db, payment.id, PaymentStatus.REJECTED)
    db.refresh(unit)
    db.refresh(product)
    revoked_at = unit.revoked_at

    assert revoked_at is not None
    assert product.total_stock_remaining == 6
    payments_crud.update_status(db, payment.id, PaymentStatus.REJECTED)
    db.refresh(unit)
    db.refresh(product)
    assert unit.revoked_at == revoked_at
    assert product.total_stock_remaining == 6


def test_manual_remove_revokes_once_and_preserves_scan_and_audit(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    _, attendee = grants._attendee(db, tenant_a, popup_tenant_a)
    product = grants._product(db, popup_tenant_a, stock=5)
    db.commit()
    actor = AuditActor(
        type=AuditActorType.USER,
        source=AuditSource.BACKOFFICE,
        id=uuid.uuid4(),
    )
    attendees_crud.add_products(
        db,
        attendee.id,
        [(product.id, 1)],
        actor=actor,
        grant_key=f"wu6-manual-{uuid.uuid4().hex}",
    )
    unit = db.exec(
        select(AttendeeProducts).where(
            AttendeeProducts.attendee_id == attendee.id,
            AttendeeProducts.product_id == product.id,
        )
    ).one()
    scan = _scan(db, popup_tenant_a, unit)

    attendees_crud.remove_product(db, attendee.id, unit.id, actor=actor)
    db.refresh(product)
    preserved = db.get(AttendeeProducts, unit.id)

    assert preserved.revoked_at is not None
    assert preserved.check_in_code == unit.check_in_code
    assert db.get(CheckIn, scan.id).attendee_product_id == unit.id
    assert product.total_stock_remaining == 5
    first_revocation = preserved.revoked_at
    attendees_crud.remove_product(db, attendee.id, unit.id, actor=actor)
    db.refresh(product)
    db.refresh(preserved)
    assert preserved.revoked_at == first_revocation
    assert product.total_stock_remaining == 5
    assert (
        db.exec(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.entity_id == attendee.id,
                AuditLog.action == AuditAction.TICKET_REMOVE,
            )
        ).one()
        == 1
    )


def test_reconciliation_reactivates_expected_and_revokes_surplus_history(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer, attendee = grants._attendee(db, tenant_a, popup_tenant_a)
    _, previous_attendee = grants._attendee(db, tenant_a, popup_tenant_a)
    product = grants._product(db, popup_tenant_a, stock=6)
    payment, line = _pending_payment(db, popup_tenant_a, buyer, attendee, product, 1)
    revoked_at = datetime(2026, 1, 1, tzinfo=UTC)
    expected = AttendeeProducts(
        tenant_id=tenant_a.id,
        attendee_id=previous_attendee.id,
        product_id=product.id,
        payment_id=payment.id,
        payment_product_id=line.id,
        unit_index=0,
        check_in_code="EXPECTED-STABLE",
        revoked_at=revoked_at,
    )
    surplus = AttendeeProducts(
        tenant_id=tenant_a.id,
        attendee_id=attendee.id,
        product_id=product.id,
        payment_id=payment.id,
        payment_product_id=line.id,
        unit_index=1,
        check_in_code="SURPLUS-STABLE",
    )
    unlinked = AttendeeProducts(
        tenant_id=tenant_a.id,
        attendee_id=attendee.id,
        product_id=product.id,
        payment_id=payment.id,
        check_in_code="UNLINKED-STABLE",
    )
    db.add_all([expected, surplus, unlinked])
    db.flush()
    scans = [_scan(db, popup_tenant_a, unit) for unit in (expected, surplus, unlinked)]

    payments_crud.approve_payment(db, payment.id)

    db.expire_all()
    reactivated = db.get(AttendeeProducts, expected.id)
    preserved_surplus = db.get(AttendeeProducts, surplus.id)
    preserved_unlinked = db.get(AttendeeProducts, unlinked.id)
    assert reactivated is not None
    assert (reactivated.id, reactivated.check_in_code) == (
        expected.id,
        "EXPECTED-STABLE",
    )
    assert reactivated.attendee_id == attendee.id
    assert reactivated.revoked_at is None
    assert preserved_surplus is not None
    assert preserved_surplus.revoked_at is not None
    assert preserved_surplus.check_in_code == "SURPLUS-STABLE"
    assert preserved_unlinked is not None
    assert preserved_unlinked.revoked_at is not None
    assert preserved_unlinked.check_in_code == "UNLINKED-STABLE"
    assert [db.get(CheckIn, scan.id).attendee_product_id for scan in scans] == [
        expected.id,
        surplus.id,
        unlinked.id,
    ]
    active = db.exec(
        select(AttendeeProducts).where(
            AttendeeProducts.payment_product_id == line.id,
            AttendeeProducts.revoked_at.is_(None),  # type: ignore[union-attr]
        )
    ).all()
    assert [(unit.id, unit.unit_index) for unit in active] == [(expected.id, 0)]
    assert len(grants._line_units(db, line)) == 2
    db.refresh(product)
    assert product.total_stock_remaining == 5


def test_manual_pending_approval_replaces_access_with_revocation(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer, attendee = grants._attendee(db, tenant_a, popup_tenant_a)
    old_product = grants._product(db, popup_tenant_a)
    new_product = grants._product(db, popup_tenant_a)
    old_unit = AttendeeProducts(
        tenant_id=tenant_a.id,
        attendee_id=attendee.id,
        product_id=old_product.id,
        check_in_code="MANUAL-OLD",
        product_category_snapshot="ticket",
    )
    db.add(old_unit)
    db.flush()
    old_scan = _scan(db, popup_tenant_a, old_unit)
    payment, line = _pending_payment(
        db, popup_tenant_a, buyer, attendee, new_product, 1
    )
    payment.edit_passes = True
    db.commit()

    payments_crud.update_status(db, payment.id, PaymentStatus.APPROVED)

    preserved = db.get(AttendeeProducts, old_unit.id)
    assert preserved is not None
    assert preserved.revoked_at is not None
    assert preserved.check_in_code == "MANUAL-OLD"
    assert db.get(CheckIn, old_scan.id).attendee_product_id == old_unit.id
    active = grants._line_units(db, line)
    assert len(active) == 1
    assert active[0].revoked_at is None
    assert active[0].attendee_id == attendee.id
