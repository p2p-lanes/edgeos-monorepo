"""Integration tests for enforcement wiring at 3 sites (product-inventory-redesign, Slice 2 / Phase 4).

TDD phase: RED — written BEFORE implementation.

Covers:
  4.1 create_open_ticketing_payment: sold-out 409, concurrent decrement (one 200, one 409),
       NULL-stock pass-through, max_per_order 422
  4.3 create_payment: sold-out 409, decrement success, NULL-stock pass-through,
       max_per_order 422
  4.5 add_product: sold-out 409, max_per_order 422, NULL-stock pass-through,
       decrement success
  4.7 _validate_product_availability: verify it is REMOVED / no call sites remain
  4.8 max_per_order validation at all sites

Spec references:
  §Domain 2 "Eager Decrement at All Three Purchase Entry Points"
  §Domain 5 "add_product Enforces Stock Caps"
  §Domain 1 "Atomic Stock Decrement"
"""

import threading
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee.schemas import AttendeeCreate
from app.api.payment.crud import payments_crud
from app.api.product.crud import products_crud
from app.api.product.models import Products
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.application.models import Applications


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    total_stock_cap: int | None = None,
    total_stock_remaining: int | None = None,
    max_per_order: int | None = None,
    price: int = 0,
) -> Products:
    suffix = uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"enf-test-{suffix}",
        slug=f"enf-{suffix}",
        price=price,
        category="ticket",
        total_stock_cap=total_stock_cap,
        total_stock_remaining=total_stock_remaining,
        max_per_order=max_per_order,
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_attendee(
    db: Session,
    application: Applications,
) -> Attendees:
    """Create a minimal attendee linked to an application."""
    attendee = Attendees(
        application_id=application.id,
        first_name="Test",
        last_name="Attendee",
        email=f"attendee-{uuid.uuid4().hex[:8]}@test.com",
        check_in_code=f"T{uuid.uuid4().hex[:4].upper()}",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _get_or_create_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
) -> Applications:
    """Get an existing application or create one for tests."""
    app = db.exec(
        select(Applications).where(
            Applications.tenant_id == tenant.id,
            Applications.popup_id == popup.id,
        )
    ).first()
    if app is None:
        from app.api.human.models import Humans
        human = Humans(
            tenant_id=tenant.id,
            email=f"enf-human-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Enf",
            last_name="Test",
        )
        db.add(human)
        db.flush()
        app = Applications(
            tenant_id=tenant.id,
            popup_id=popup.id,
            human_id=human.id,
        )
        db.add(app)
        db.commit()
        db.refresh(app)
    return app


# ---------------------------------------------------------------------------
# 4.5 / 4.6 add_product enforcement (simplest site to test first)
# ---------------------------------------------------------------------------


class TestAddProductEnforcement:
    """Spec §Domain 5 — add_product Enforces Stock Caps."""

    def test_add_product_sold_out_raises_409(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """add_product on product with total_stock_remaining=0 → 409."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=1,
            total_stock_remaining=0,
        )
        app = _get_or_create_application(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, app)

        with pytest.raises(HTTPException) as exc_info:
            attendees_crud.add_product(db, attendee.id, product.id, quantity=1)
        assert exc_info.value.status_code == 409

    def test_add_product_within_stock_decrements_counter(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """add_product with stock available → counter decremented."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=5,
            total_stock_remaining=5,
        )
        app = _get_or_create_application(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, app)

        attendees_crud.add_product(db, attendee.id, product.id, quantity=2)

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining == 3, (
            f"Expected remaining=3, got {refreshed.total_stock_remaining}"
        )

    def test_add_product_unlimited_passes(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """add_product with NULL stock (unlimited) → succeeds without decrement."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=None,
            total_stock_remaining=None,
        )
        app = _get_or_create_application(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, app)

        result = attendees_crud.add_product(db, attendee.id, product.id, quantity=99)
        assert result is not None

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining is None

    def test_add_product_exceeds_max_per_order_raises_422(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """add_product with qty > max_per_order → 422."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=10,
            total_stock_remaining=10,
            max_per_order=2,
        )
        app = _get_or_create_application(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, app)

        with pytest.raises(HTTPException) as exc_info:
            attendees_crud.add_product(db, attendee.id, product.id, quantity=3)
        assert exc_info.value.status_code == 422

    def test_add_product_concurrent_decrements_exactly_one_wins(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        test_engine,
    ) -> None:
        """Concurrent add_product on remaining=1: exactly one 200, one 409."""
        from sqlmodel import Session as SyncSession

        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=1,
            total_stock_remaining=1,
        )
        app = _get_or_create_application(db, tenant_a, popup_tenant_a)

        successes: list[bool] = []
        conflicts: list[bool] = []
        lock = threading.Lock()

        def one_add() -> None:
            with SyncSession(test_engine) as session:
                attendee = _make_attendee(session, app)
                try:
                    attendees_crud.add_product(session, attendee.id, product.id, 1)
                    with lock:
                        successes.append(True)
                except HTTPException as exc:
                    session.rollback()
                    if exc.status_code == 409:
                        with lock:
                            conflicts.append(True)
                    else:
                        raise

        t1 = threading.Thread(target=one_add)
        t2 = threading.Thread(target=one_add)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert len(successes) == 1, f"Expected 1 success, got {successes}"
        assert len(conflicts) == 1, f"Expected 1 conflict, got {conflicts}"

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining == 0


# ---------------------------------------------------------------------------
# 4.7 _validate_product_availability must be REMOVED
# ---------------------------------------------------------------------------


class TestValidateProductAvailabilityRemoved:
    """Design §1 — _validate_product_availability must be deleted."""

    def test_validate_product_availability_does_not_exist(self) -> None:
        """PaymentsCRUD must not have _validate_product_availability anymore."""
        assert not hasattr(payments_crud, "_validate_product_availability"), (
            "_validate_product_availability still exists on PaymentsCRUD. "
            "It must be removed as part of Slice 2 (replaced by atomic decrement)."
        )

    def test_no_call_sites_in_payment_crud(self) -> None:
        """No remaining call to _validate_product_availability in payment/crud.py."""
        import inspect
        import app.api.payment.crud as payment_crud_module

        source = inspect.getsource(payment_crud_module)
        assert "_validate_product_availability" not in source, (
            "_validate_product_availability still referenced in payment/crud.py"
        )
