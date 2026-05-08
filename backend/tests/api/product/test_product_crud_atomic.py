"""Unit tests for atomic stock CRUD operations (product-inventory-redesign, Slice 1 / Phase 3).

TDD phase: RED — written BEFORE the implementation exists.
Tests cover:
  - decrement_total_stock: success, sold-out, unlimited (NULL), not-found
  - restore_total_stock: success, LEAST clamp, unlimited no-op

Spec references:
  §Domain 1 "Atomic Stock Decrement", §Domain 1 "Stock Restoration",
  §Domain 1 "Restoration idempotency"
"""

import threading
import uuid

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.product.crud import products_crud
from app.api.product.models import Products
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    total_stock_cap: int | None,
    total_stock_remaining: int | None,
) -> Products:
    """Insert a minimal product row with the given stock columns."""
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"atomic-test-{uuid.uuid4().hex[:8]}",
        slug=f"atomic-{uuid.uuid4().hex[:8]}",
        price=10,
        category="ticket",
        total_stock_cap=total_stock_cap,
        total_stock_remaining=total_stock_remaining,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


# ---------------------------------------------------------------------------
# decrement_total_stock
# ---------------------------------------------------------------------------


class TestDecrementTotalStock:
    """Spec §Domain 1 — Atomic Stock Decrement."""

    def test_success_decrements_counter_and_returns_product(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Sufficient stock: counter decrements; product returned."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=10,
            total_stock_remaining=10,
        )
        result = products_crud.decrement_total_stock(db, product.id, 3)
        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert result is not None
        assert refreshed.total_stock_remaining == 7, (
            f"expected 7, got {refreshed.total_stock_remaining}"
        )

    def test_sold_out_raises_409(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """total_stock_remaining < qty → HTTP 409 'Sold out'."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=5,
            total_stock_remaining=1,
        )
        with pytest.raises(HTTPException) as exc_info:
            products_crud.decrement_total_stock(db, product.id, 2)
        assert exc_info.value.status_code == 409, (
            f"expected 409, got {exc_info.value.status_code}"
        )

    def test_unlimited_product_returns_product_without_decrement(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """total_stock_remaining IS NULL (unlimited) → no-op; product returned; no 409."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=None,
            total_stock_remaining=None,
        )
        result = products_crud.decrement_total_stock(db, product.id, 99)
        assert result is not None
        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining is None, (
            "unlimited product must remain NULL after decrement"
        )

    def test_product_not_found_raises_404(
        self,
        db: Session,
    ) -> None:
        """Non-existent product_id → HTTP 404."""
        with pytest.raises(HTTPException) as exc_info:
            products_crud.decrement_total_stock(db, uuid.uuid4(), 1)
        assert exc_info.value.status_code == 404

    def test_atomic_guard_concurrent_decrements(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        test_engine,
    ) -> None:
        """Concurrent decrements on remaining=1: exactly one succeeds, one 409.

        Uses two independent SQLAlchemy sessions to simulate concurrent buyers.
        """
        from sqlmodel import Session as SyncSession

        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=1,
            total_stock_remaining=1,
        )
        product_id = product.id

        successes: list[bool] = []
        conflicts: list[bool] = []
        lock = threading.Lock()

        def one_decrement() -> None:
            with SyncSession(test_engine) as session:
                try:
                    products_crud.decrement_total_stock(session, product_id, 1)
                    session.commit()
                    with lock:
                        successes.append(True)
                except HTTPException as exc:
                    session.rollback()
                    if exc.status_code == 409:
                        with lock:
                            conflicts.append(True)
                    else:
                        raise

        t1 = threading.Thread(target=one_decrement)
        t2 = threading.Thread(target=one_decrement)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert len(successes) == 1, f"Expected 1 success, got {len(successes)}"
        assert len(conflicts) == 1, f"Expected 1 conflict, got {len(conflicts)}"

        db.expire_all()
        refreshed = db.get(Products, product_id)
        assert refreshed.total_stock_remaining == 0


# ---------------------------------------------------------------------------
# restore_total_stock
# ---------------------------------------------------------------------------


class TestRestoreTotalStock:
    """Spec §Domain 1 — Stock Restoration idempotency."""

    def test_success_restores_counter(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Held stock restored: total_stock_remaining increases by qty."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=10,
            total_stock_remaining=7,  # 3 were held
        )
        products_crud.restore_total_stock(db, product.id, 3)
        db.commit()
        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining == 10, (
            f"expected 10, got {refreshed.total_stock_remaining}"
        )

    def test_least_clamp_cannot_exceed_cap(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """LEAST(cap, remaining + qty) prevents drift past cap on double-fire."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=5,
            total_stock_remaining=5,  # already at cap
        )
        products_crud.restore_total_stock(db, product.id, 2)
        db.commit()
        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining == 5, (
            f"LEAST clamp must cap at 5, got {refreshed.total_stock_remaining}"
        )

    def test_unlimited_product_is_noop(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """NULL total_stock_remaining / cap: restore is a silent no-op."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=None,
            total_stock_remaining=None,
        )
        # Must not raise, must not error
        products_crud.restore_total_stock(db, product.id, 5)
        db.commit()
        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining is None


