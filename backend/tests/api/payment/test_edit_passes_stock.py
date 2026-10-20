"""Portal replacements release old inventory only at settlement, exactly once."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from decimal import Decimal
from threading import Barrier

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.payment.crud import payments_crud
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.crud import products_crud
from app.api.tenant.models import Tenants
from tests.api.payment import test_product_unit_grants as grants
from tests.api.payment.test_product_unit_lifecycle import _pending_payment


def _setup(db, tenant, popup, *, quantity=2, unlimited=False):
    buyer, attendee = grants._attendee(db, tenant, popup)
    old = grants._product(db, popup, stock=10)
    new = grants._product(db, popup, stock=10)
    if unlimited:
        old.total_stock_cap = old.total_stock_remaining = None
        new.total_stock_cap = new.total_stock_remaining = None
    original, old_line = _pending_payment(db, popup, buyer, attendee, old, quantity)
    payments_crud.approve_payment(db, original.id)
    replacement, new_line = _pending_payment(db, popup, buyer, attendee, new, quantity)
    replacement.edit_passes = True
    db.commit()
    return old, new, original, old_line, replacement, new_line


@pytest.mark.parametrize("settlement", ["approve", "status", "zero"])
@pytest.mark.parametrize("unlimited", [False, True])
def test_settlement_returns_old_stock_and_original_cancel_cannot_return_it_again(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    settlement: str,
    unlimited: bool,
) -> None:
    old, new, original, old_line, replacement, new_line = _setup(
        db, tenant_a, popup_tenant_a, unlimited=unlimited
    )
    db.refresh(old)
    db.refresh(new)
    assert old.total_stock_remaining == (None if unlimited else 8)
    assert new.total_stock_remaining == (None if unlimited else 8)
    assert all(u.revoked_at is None for u in grants._line_units(db, old_line))

    if settlement == "zero":
        replacement.amount = Decimal("0")
        payments_crud._finalize_zero_amount_payment(
            db, replacement, [], replace_access=True
        )
        db.commit()
    elif settlement == "status":
        payments_crud.update_status(db, replacement.id, PaymentStatus.APPROVED)
    else:
        payments_crud.approve_payment(db, replacement.id)

    old_units = grants._line_units(db, old_line)
    assert all(
        u.revoked_at is not None and u.stock_released_at is not None for u in old_units
    )
    returned_at = [u.stock_released_at for u in old_units]
    assert all(u.revoked_at is None for u in grants._line_units(db, new_line))
    db.refresh(old)
    db.refresh(new)
    assert old.total_stock_remaining == (None if unlimited else 10)
    assert new.total_stock_remaining == (None if unlimited else 8)

    # Another sale makes a duplicate return visible despite the stock-cap clamp.
    products_crud.decrement_total_stock(db, old.id, 3)
    db.commit()
    payments_crud.approve_payment(db, replacement.id)
    payments_crud.update_status(db, replacement.id, PaymentStatus.APPROVED)
    payments_crud.approve_payment(db, original.id)
    payments_crud.update_status(db, original.id, PaymentStatus.APPROVED)
    assert all(u.revoked_at is not None for u in grants._line_units(db, old_line))
    assert [
        u.stock_released_at for u in grants._line_units(db, old_line)
    ] == returned_at

    for _ in range(2):
        payments_crud.update_status(db, original.id, PaymentStatus.CANCELLED)
        db.refresh(old)
        assert old.total_stock_remaining == (None if unlimited else 7)
        assert all(u.revoked_at is None for u in grants._line_units(db, new_line))

    payments_crud.update_status(db, replacement.id, PaymentStatus.CANCELLED)
    db.refresh(new)
    assert new.total_stock_remaining == (None if unlimited else 10)


@pytest.mark.parametrize(
    "status", [PaymentStatus.REJECTED, PaymentStatus.EXPIRED, PaymentStatus.CANCELLED]
)
def test_failed_change_keeps_old_passes_and_releases_only_new_reservation(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    status: PaymentStatus,
) -> None:
    old, new, _, old_line, replacement, _ = _setup(db, tenant_a, popup_tenant_a)
    for _ in range(2):
        payments_crud.update_status(db, replacement.id, status)
        db.refresh(old)
        db.refresh(new)
        assert (old.total_stock_remaining, new.total_stock_remaining) == (8, 10)
        assert all(
            u.revoked_at is None and u.stock_released_at is None
            for u in grants._line_units(db, old_line)
        )


def test_partial_replacement_cancellation_returns_only_unreleased_lines(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    old, new, original, old_line, replacement, _ = _setup(db, tenant_a, popup_tenant_a)
    # Another recipient on the original payment is unaffected by this edit.
    _, other = grants._attendee(db, tenant_a, popup_tenant_a)
    other_line = grants._line(db, original, old, 3, other)
    products_crud.decrement_total_stock(db, old.id, 3)
    db.commit()
    payments_crud.approve_payment(db, original.id)
    payments_crud.approve_payment(db, replacement.id)
    db.refresh(old)
    assert old.total_stock_remaining == 7
    assert all(u.revoked_at is None for u in grants._line_units(db, other_line))
    assert all(u.revoked_at is not None for u in grants._line_units(db, old_line))
    products_crud.decrement_total_stock(db, old.id, 2)
    db.commit()
    payments_crud.update_status(db, original.id, PaymentStatus.CANCELLED)
    db.refresh(old)
    db.refresh(new)
    assert (old.total_stock_remaining, new.total_stock_remaining) == (8, 8)


def test_legacy_units_without_lineage_are_not_returned_again_on_cancel(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    old, _, original, old_line, replacement, _ = _setup(db, tenant_a, popup_tenant_a)
    for unit in grants._line_units(db, old_line):
        unit.payment_product_id = unit.unit_index = None
        db.add(unit)
    db.commit()
    payments_crud.approve_payment(db, replacement.id)
    products_crud.decrement_total_stock(db, old.id, 3)
    db.commit()
    payments_crud.update_status(db, original.id, PaymentStatus.CANCELLED)
    db.refresh(old)
    assert old.total_stock_remaining == 7


def test_historical_revocation_without_release_marker_still_returns_on_cancel(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    old, _, original, old_line, _, _ = _setup(db, tenant_a, popup_tenant_a)
    for unit in grants._line_units(db, old_line):
        unit.revoked_at = datetime.now(UTC)
        db.add(unit)
    db.commit()
    payments_crud.update_status(db, original.id, PaymentStatus.CANCELLED)
    db.refresh(old)
    assert old.total_stock_remaining == 10


def test_failed_settlement_rolls_back_stock_and_release_markers(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    monkeypatch,
) -> None:
    old, new, _, old_line, replacement, _ = _setup(db, tenant_a, popup_tenant_a)
    from app.api.accommodation import payments as accommodation_payments

    def fail(*_args):
        raise RuntimeError("settlement failed after replacing access")

    monkeypatch.setattr(accommodation_payments, "confirm_for_payment", fail)
    with pytest.raises(HTTPException) as exc:
        payments_crud.approve_payment(db, replacement.id)
    assert exc.value.status_code == 500
    db.refresh(old)
    db.refresh(new)
    assert (old.total_stock_remaining, new.total_stock_remaining) == (8, 8)
    assert all(
        u.revoked_at is None and u.stock_released_at is None
        for u in grants._line_units(db, old_line)
    )


@pytest.mark.parametrize(
    "concurrent_action", ["approve_replacement", "cancel_original"]
)
def test_concurrent_confirmation_and_cancellation_return_stock_once(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    concurrent_action: str,
) -> None:
    old, _, original, old_line, replacement, _ = _setup(db, tenant_a, popup_tenant_a)
    products_crud.decrement_total_stock(db, old.id, 3)
    db.commit()
    original_id, replacement_id = original.id, replacement.id
    engine = db.get_bind()
    start = Barrier(2)

    def settle(action):
        with Session(engine) as session:
            start.wait(timeout=10)
            if action == "cancel_original":
                payments_crud.update_status(
                    session, original_id, PaymentStatus.CANCELLED
                )
            else:
                payments_crud.approve_payment(session, replacement_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(settle, action)
            for action in ("approve_replacement", concurrent_action)
        ]
        for future in futures:
            future.result(timeout=20)

    db.expire_all()
    db.refresh(old)
    assert old.total_stock_remaining == 7
    assert all(u.revoked_at is not None for u in grants._line_units(db, old_line))


def test_zero_cost_portal_checkout_releases_previous_stock(
    db: Session,
    tenant_a: Tenants,
) -> None:
    from app.api.attendee.crud import attendees_crud
    from app.api.payment.schemas import PaymentCreate, PaymentProductRequest
    from tests.api.payment import test_credit_zero_branch as credit

    popup = credit._make_popup(db, tenant_a)
    human = credit._make_human(db, tenant_a)
    application = credit._make_application(
        db, tenant_a, popup, human, credit=Decimal("0")
    )
    attendee = credit._make_attendee(db, tenant_a, popup, application)
    old = credit._make_product(db, tenant_a, popup, price=Decimal("100"))
    new = credit._make_product(db, tenant_a, popup, price=Decimal("30"))
    for product in (old, new):
        product.total_stock_cap = product.total_stock_remaining = 5
        db.add(product)
    db.commit()
    holding = attendees_crud.add_product(db, attendee.id, old.id)
    payment, _ = payments_crud.create_payment(
        db,
        PaymentCreate(
            application_id=application.id,
            products=[
                PaymentProductRequest(
                    product_id=new.id, attendee_id=attendee.id, quantity=1
                )
            ],
            edit_passes=True,
        ),
        attribution=None,
    )
    db.refresh(old)
    db.refresh(new)
    db.refresh(holding)
    assert payment.status == PaymentStatus.APPROVED.value
    assert (old.total_stock_remaining, new.total_stock_remaining) == (5, 4)
    assert holding.revoked_at is not None
    assert holding.stock_released_at is not None
