"""Tests for cross-field stock cap validator (product-inventory-redesign, Slice 2 / Phase 2).

Covers:
  2.1 ProductCreate/Update with total_stock_cap=0 or max_per_order=0 → 422 (Pydantic ge=1)
  2.7 Smoke: valid combinations still pass

Spec references:
  §Domain 4 "Zero value rejected at schema level"
"""

import uuid

import pytest
from pydantic import ValidationError

from app.api.product.schemas import ProductCreate, ProductUpdate

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
# Cross-field: max_per_order <= total_stock_cap
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
