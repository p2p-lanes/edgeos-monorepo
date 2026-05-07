"""Tests for cross-field stock cap validator (product-inventory-redesign, Slice 2 / Phase 2).

TDD phase: RED — written BEFORE the implementation exists.

Covers:
  2.1 ProductCreate/Update with total_stock_cap=0 or max_per_order=0 → 422 (Pydantic ge=1)
  2.3 Service-layer guard: total_stock_cap on tier-grouped product with shared_stock_cap → 422
  2.3 Association direction: adding a product (with total_stock_cap set) to a group
      that has shared_stock_cap → 422
  2.7 Smoke: valid combinations still pass

Spec references:
  §Domain 4 "Forbid total_stock_cap + shared_stock_cap Coexistence"
  §Domain 4 "Zero value rejected at schema level"
  Design §6.1 assert_no_total_vs_shared_stock_conflict
  Design §6.3 validator call sites (both directions)
"""

import uuid

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlmodel import Session, select

from app.api.product.models import Products, TicketTierGroup, TicketTierPhase
from app.api.product.schemas import ProductCreate, ProductUpdate
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
    total_stock_cap: int | None = None,
    total_stock_remaining: int | None = None,
) -> Products:
    suffix = uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"validator-test-{suffix}",
        slug=f"validator-{suffix}",
        price=10,
        category="ticket",
        total_stock_cap=total_stock_cap,
        total_stock_remaining=total_stock_remaining,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_tier_group(
    db: Session,
    tenant: Tenants,
    *,
    shared_stock_cap: int | None = 100,
) -> TicketTierGroup:
    group = TicketTierGroup(
        tenant_id=tenant.id,
        name=f"val-group-{uuid.uuid4().hex[:8]}",
        shared_stock_cap=shared_stock_cap,
        shared_stock_remaining=shared_stock_cap,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


def _link_product_to_group(
    db: Session,
    product: Products,
    group: TicketTierGroup,
    *,
    order: int = 1,
) -> TicketTierPhase:
    phase = TicketTierPhase(
        group_id=group.id,
        product_id=product.id,
        order=order,
        label="Phase 1",
    )
    db.add(phase)
    db.commit()
    db.refresh(phase)
    return phase


# ---------------------------------------------------------------------------
# 2.1 Pydantic schema-level ge=1 guard
# ---------------------------------------------------------------------------


class TestPydanticSchemaGuards:
    """Domain 4 §Zero value rejected at schema level."""

    def test_product_create_total_stock_cap_zero_rejected(self) -> None:
        """total_stock_cap=0 in ProductCreate → Pydantic ValidationError (ge=1)."""
        with pytest.raises(ValidationError) as exc_info:
            ProductCreate(
                popup_id=uuid.uuid4(),
                name="Test",
                slug="test",
                price=10,
                total_stock_cap=0,
            )
        errors = exc_info.value.errors()
        assert any("total_stock_cap" in str(e) for e in errors), (
            f"expected total_stock_cap in errors, got: {errors}"
        )

    def test_product_create_max_per_order_zero_rejected(self) -> None:
        """max_per_order=0 in ProductCreate → Pydantic ValidationError (ge=1)."""
        with pytest.raises(ValidationError) as exc_info:
            ProductCreate(
                popup_id=uuid.uuid4(),
                name="Test",
                slug="test",
                price=10,
                max_per_order=0,
            )
        errors = exc_info.value.errors()
        assert any("max_per_order" in str(e) for e in errors), (
            f"expected max_per_order in errors, got: {errors}"
        )

    def test_product_update_total_stock_cap_zero_rejected(self) -> None:
        """total_stock_cap=0 in ProductUpdate → Pydantic ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            ProductUpdate(total_stock_cap=0)
        errors = exc_info.value.errors()
        assert any("total_stock_cap" in str(e) for e in errors)

    def test_product_update_max_per_order_zero_rejected(self) -> None:
        """max_per_order=0 in ProductUpdate → Pydantic ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            ProductUpdate(max_per_order=0)
        errors = exc_info.value.errors()
        assert any("max_per_order" in str(e) for e in errors)

    def test_product_create_valid_values_accepted(self) -> None:
        """Non-zero values and NULL accepted by schema."""
        pc = ProductCreate(
            popup_id=uuid.uuid4(),
            name="Valid",
            slug="valid",
            price=10,
            total_stock_cap=50,
            max_per_order=3,
        )
        assert pc.total_stock_cap == 50
        assert pc.max_per_order == 3

    def test_product_create_null_caps_accepted(self) -> None:
        """NULL caps (unlimited) accepted."""
        pc = ProductCreate(
            popup_id=uuid.uuid4(),
            name="Unlimited",
            slug="unlimited",
            price=10,
        )
        assert pc.total_stock_cap is None
        assert pc.max_per_order is None


# ---------------------------------------------------------------------------
# 2.3 Service-layer validator: product direction
# ---------------------------------------------------------------------------


class TestServiceLayerValidatorProductDirection:
    """Domain 4 §Tier-grouped product with total_stock_cap rejected (product update side)."""

    def test_product_with_total_stock_cap_in_group_raises_422(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Setting total_stock_cap on a product already in a group with shared_stock_cap → 422."""
        from app.api.product.validators import assert_no_total_vs_shared_stock_conflict

        product = _make_product(db, tenant_a, popup_tenant_a)
        group = _make_tier_group(db, tenant_a, shared_stock_cap=100)
        _link_product_to_group(db, product, group)

        with pytest.raises(HTTPException) as exc_info:
            assert_no_total_vs_shared_stock_conflict(
                db, product.id, proposed_total_stock_cap=50
            )
        assert exc_info.value.status_code == 422

    def test_product_with_null_cap_in_group_passes(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Setting total_stock_cap=NULL on tier-grouped product → allowed."""
        from app.api.product.validators import assert_no_total_vs_shared_stock_conflict

        product = _make_product(db, tenant_a, popup_tenant_a)
        group = _make_tier_group(db, tenant_a, shared_stock_cap=100)
        _link_product_to_group(db, product, group)

        # Should NOT raise
        assert_no_total_vs_shared_stock_conflict(
            db, product.id, proposed_total_stock_cap=None
        )

    def test_standalone_product_with_total_stock_cap_passes(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Standalone product (no tier group) accepts total_stock_cap."""
        from app.api.product.validators import assert_no_total_vs_shared_stock_conflict

        product = _make_product(db, tenant_a, popup_tenant_a)

        # Should NOT raise
        assert_no_total_vs_shared_stock_conflict(
            db, product.id, proposed_total_stock_cap=200
        )

    def test_group_without_shared_cap_passes(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Product in tier group but group has shared_stock_cap=NULL → allowed."""
        from app.api.product.validators import assert_no_total_vs_shared_stock_conflict

        product = _make_product(db, tenant_a, popup_tenant_a)
        group = _make_tier_group(db, tenant_a, shared_stock_cap=None)
        _link_product_to_group(db, product, group, order=2)

        # Should NOT raise — group has no shared cap
        assert_no_total_vs_shared_stock_conflict(
            db, product.id, proposed_total_stock_cap=50
        )

    def test_none_product_id_passes(self, db: Session) -> None:
        """product_id=None (creation flow pre-phase) → allowed."""
        from app.api.product.validators import assert_no_total_vs_shared_stock_conflict

        # Should NOT raise — no product_id means no phase row to check
        assert_no_total_vs_shared_stock_conflict(
            db, None, proposed_total_stock_cap=50
        )


# ---------------------------------------------------------------------------
# 2.3 Service-layer validator: tier-phase association direction
# ---------------------------------------------------------------------------


class TestServiceLayerValidatorAssociationDirection:
    """Domain 4 §Tier-grouped product with total_stock_cap rejected (association side).

    When a product that has total_stock_cap set is being linked to a group
    that has shared_stock_cap, the validator must reject from the association
    direction too. This is exercised via TierPhasesCRUD.create_for_group.
    """

    def test_adding_stock_capped_product_to_shared_cap_group_raises_422(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Associating a product (total_stock_cap=50) to a group with shared_stock_cap → 422."""
        from app.api.product.crud import tier_phases_crud
        from app.api.product.schemas import TierPhaseCreate

        # product has its own total_stock_cap
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=50,
            total_stock_remaining=50,
        )
        group = _make_tier_group(db, tenant_a, shared_stock_cap=200)

        create_obj = TierPhaseCreate(
            group_id=group.id,
            product_id=product.id,
            label="Conflict Phase",
        )
        with pytest.raises(HTTPException) as exc_info:
            tier_phases_crud.create_for_group(db, create_obj)
        db.rollback()  # clean up after expected failure
        assert exc_info.value.status_code == 422

    def test_adding_null_cap_product_to_shared_cap_group_passes(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Product with total_stock_cap=NULL added to shared-cap group → allowed."""
        from app.api.product.crud import tier_phases_crud
        from app.api.product.schemas import TierPhaseCreate

        product = _make_product(db, tenant_a, popup_tenant_a)
        group = _make_tier_group(db, tenant_a, shared_stock_cap=200)

        create_obj = TierPhaseCreate(
            group_id=group.id,
            product_id=product.id,
            label="OK Phase",
        )
        # Should NOT raise
        phase = tier_phases_crud.create_for_group(db, create_obj)
        assert phase.id is not None
        # cleanup
        db.delete(phase)
        db.commit()


# ---------------------------------------------------------------------------
# 2.5  ProductsCRUD.update wiring
# ---------------------------------------------------------------------------


class TestProductsCRUDUpdateWiring:
    """Task 2.5 — validator is enforced when updating a product via ProductsCRUD.update.

    When a product that belongs to a tier group with shared_stock_cap is updated
    to set total_stock_cap, ProductsCRUD.update must raise 422.
    """

    def test_update_sets_total_stock_cap_on_grouped_product_raises_422(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """ProductsCRUD.update with total_stock_cap on a tier-grouped product → 422."""
        from app.api.product.crud import products_crud
        from app.api.product.schemas import ProductUpdate

        product = _make_product(db, tenant_a, popup_tenant_a)
        group = _make_tier_group(db, tenant_a, shared_stock_cap=100)
        _link_product_to_group(db, product, group)

        with pytest.raises(HTTPException) as exc_info:
            products_crud.update(
                db,
                product,
                ProductUpdate(total_stock_cap=50),
            )
        assert exc_info.value.status_code == 422

    def test_update_clears_total_stock_cap_on_grouped_product_passes(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """ProductsCRUD.update setting total_stock_cap=None on tier-grouped product → allowed."""
        from app.api.product.crud import products_crud
        from app.api.product.schemas import ProductUpdate

        # Product already has no total_stock_cap; updating with None is a no-op allowed.
        product = _make_product(db, tenant_a, popup_tenant_a)
        group = _make_tier_group(db, tenant_a, shared_stock_cap=100)
        _link_product_to_group(db, product, group)

        # Should NOT raise — setting cap to None (unlimited) is always allowed.
        updated = products_crud.update(
            db,
            product,
            ProductUpdate(total_stock_cap=None),
        )
        assert updated.total_stock_cap is None

    def test_update_standalone_product_with_total_stock_cap_passes(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Updating a standalone product with total_stock_cap → allowed."""
        from app.api.product.crud import products_crud
        from app.api.product.schemas import ProductUpdate

        product = _make_product(db, tenant_a, popup_tenant_a)

        # Should NOT raise — no tier group, no conflict.
        updated = products_crud.update(
            db,
            product,
            ProductUpdate(total_stock_cap=200, total_stock_remaining=200),
        )
        assert updated.total_stock_cap == 200


# ---------------------------------------------------------------------------
# Cross-field: max_per_order <= total_stock_cap
# TDD: RED — written before the implementation.
# ---------------------------------------------------------------------------


class TestMaxPerOrderVsTotalStockCap:
    """max_per_order must not exceed total_stock_cap when both are set."""

    def test_product_create_max_per_order_exceeds_stock_cap_rejected(self) -> None:
        """ProductCreate with max_per_order > total_stock_cap → ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            ProductCreate(
                popup_id=uuid.uuid4(),
                name="Test",
                slug="test",
                price=10,
                max_per_order=10,
                total_stock_cap=5,
            )
        errors = exc_info.value.errors()
        assert any("max_per_order" in str(e) or "total_stock_cap" in str(e) for e in errors), (
            f"expected cross-field error in errors, got: {errors}"
        )

    def test_product_create_max_per_order_equals_stock_cap_accepted(self) -> None:
        """ProductCreate with max_per_order == total_stock_cap → allowed."""
        pc = ProductCreate(
            popup_id=uuid.uuid4(),
            name="Equal",
            slug="equal",
            price=10,
            max_per_order=5,
            total_stock_cap=5,
        )
        assert pc.max_per_order == 5
        assert pc.total_stock_cap == 5

    def test_product_create_max_per_order_less_than_stock_cap_accepted(self) -> None:
        """ProductCreate with max_per_order < total_stock_cap → allowed."""
        pc = ProductCreate(
            popup_id=uuid.uuid4(),
            name="Valid",
            slug="valid",
            price=10,
            max_per_order=5,
            total_stock_cap=10,
        )
        assert pc.max_per_order == 5

    def test_product_create_max_per_order_set_stock_cap_null_accepted(self) -> None:
        """ProductCreate with max_per_order set but total_stock_cap=None → allowed (unlimited)."""
        pc = ProductCreate(
            popup_id=uuid.uuid4(),
            name="NullCap",
            slug="null-cap",
            price=10,
            max_per_order=10,
            total_stock_cap=None,
        )
        assert pc.max_per_order == 10
        assert pc.total_stock_cap is None

    def test_product_update_max_per_order_exceeds_stock_cap_rejected(self) -> None:
        """ProductUpdate with max_per_order > total_stock_cap → ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            ProductUpdate(max_per_order=10, total_stock_cap=5)
        errors = exc_info.value.errors()
        assert any("max_per_order" in str(e) or "total_stock_cap" in str(e) for e in errors), (
            f"expected cross-field error in errors, got: {errors}"
        )

    def test_product_update_max_per_order_valid_combination_accepted(self) -> None:
        """ProductUpdate with max_per_order <= total_stock_cap → allowed."""
        pu = ProductUpdate(max_per_order=3, total_stock_cap=10)
        assert pu.max_per_order == 3
