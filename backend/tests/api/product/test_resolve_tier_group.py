"""Unit tests for _resolve_tier_group helper (product-inventory-redesign, Slice 2 / task 3.7).

TDD phase: RED — written BEFORE the implementation exists.
Tests cover:
  - standalone product → None
  - tier-grouped product → group UUID
  - non-existent product_id → None

Spec references:
  §Domain 2 "Enforcement Wiring", Design §4.1/_resolve_tier_group helper.
"""

import uuid

import pytest
from sqlmodel import Session

from app.api.product.models import Products, TicketTierGroup, TicketTierPhase
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    name_suffix: str | None = None,
) -> Products:
    """Insert a minimal standalone product."""
    suffix = name_suffix or uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"resolve-test-{suffix}",
        slug=f"resolve-{suffix}",
        price=10,
        category="ticket",
        total_stock_cap=None,
        total_stock_remaining=None,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_tier_group(db: Session, tenant: Tenants) -> TicketTierGroup:
    group = TicketTierGroup(
        tenant_id=tenant.id,
        name=f"rg-group-{uuid.uuid4().hex[:8]}",
        shared_stock_cap=100,
        shared_stock_remaining=100,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


def _link_product_to_group(
    db: Session, product: Products, group: TicketTierGroup
) -> TicketTierPhase:
    phase = TicketTierPhase(
        group_id=group.id,
        product_id=product.id,
        order=1,
        label="Early Bird",
    )
    db.add(phase)
    db.commit()
    db.refresh(phase)
    return phase


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestResolveTierGroup:
    """Design §4.1 — _resolve_tier_group helper."""

    def test_standalone_product_returns_none(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Standalone product (no tier phase row) → returns None."""
        from app.api.product.crud import _resolve_tier_group

        product = _make_product(db, tenant_a, popup_tenant_a)
        result = _resolve_tier_group(db, product.id)
        assert result is None, f"Expected None for standalone product, got {result}"

    def test_tier_grouped_product_returns_group_id(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Product assigned to a tier group → returns the group UUID."""
        from app.api.product.crud import _resolve_tier_group

        product = _make_product(db, tenant_a, popup_tenant_a)
        group = _make_tier_group(db, tenant_a)
        _link_product_to_group(db, product, group)

        result = _resolve_tier_group(db, product.id)
        assert result == group.id, (
            f"Expected group.id={group.id}, got {result}"
        )

    def test_nonexistent_product_id_returns_none(
        self,
        db: Session,
    ) -> None:
        """Non-existent product_id → returns None (no row to join)."""
        from app.api.product.crud import _resolve_tier_group

        result = _resolve_tier_group(db, uuid.uuid4())
        assert result is None, (
            f"Expected None for unknown product_id, got {result}"
        )

    def test_product_removed_from_group_returns_none(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """After phase row is deleted, product resolves to None again."""
        from app.api.product.crud import _resolve_tier_group

        product = _make_product(db, tenant_a, popup_tenant_a)
        group = _make_tier_group(db, tenant_a)
        phase = _link_product_to_group(db, product, group)

        # verify it resolves before deletion
        assert _resolve_tier_group(db, product.id) == group.id

        # delete the phase row
        db.delete(phase)
        db.commit()

        result = _resolve_tier_group(db, product.id)
        assert result is None, (
            f"Expected None after phase deletion, got {result}"
        )
