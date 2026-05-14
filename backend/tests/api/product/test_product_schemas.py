"""Unit tests for ProductCreate/ProductUpdate patreon price coercion validator.

Spec: patron-product Requirement: Patreon Price Coercion
"""

import uuid
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.api.product.schemas import ProductCreate, ProductUpdate


class TestProductCreatePatreonPrice:
    """ProductCreate must reject price > 0 for category=patreon."""

    def test_patreon_with_zero_price_is_valid(self) -> None:
        """category=patreon, price=0 is valid."""
        product = ProductCreate(
            popup_id=uuid.uuid4(),
            name="Patron",
            price=Decimal("0"),
            category="patreon",
        )
        assert product.price == Decimal("0")

    def test_patreon_with_nonzero_price_raises_422(self) -> None:
        """category=patreon, price>0 must raise ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            ProductCreate(
                popup_id=uuid.uuid4(),
                name="Patron",
                price=Decimal("500"),
                category="patreon",
            )
        errors = exc_info.value.errors()
        assert any(
            "patreon" in str(e).lower() or "price" in str(e).lower() for e in errors
        ), f"Expected patreon/price error, got: {errors}"

    def test_ticket_with_nonzero_price_is_valid(self) -> None:
        """category=ticket, price>0 remains valid (unchanged behavior)."""
        product = ProductCreate(
            popup_id=uuid.uuid4(),
            name="General Admission",
            price=Decimal("500"),
            category="ticket",
        )
        assert product.price == Decimal("500")

    def test_patreon_with_small_nonzero_price_raises_422(self) -> None:
        """category=patreon, price=0.01 is still nonzero and must be rejected."""
        with pytest.raises(ValidationError):
            ProductCreate(
                popup_id=uuid.uuid4(),
                name="Patron",
                price=Decimal("0.01"),
                category="patreon",
            )


class TestProductUpdatePatreonPrice:
    """ProductUpdate must reject price > 0 when category is (being set to) patreon."""

    def test_patreon_category_with_nonzero_price_raises_422(self) -> None:
        """PATCH category=patreon, price=500 must raise ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            ProductUpdate(
                category="patreon",
                price=Decimal("500"),
            )
        errors = exc_info.value.errors()
        assert any(
            "patreon" in str(e).lower() or "price" in str(e).lower() for e in errors
        ), f"Expected patreon/price error, got: {errors}"

    def test_patreon_category_with_zero_price_is_valid(self) -> None:
        """PATCH category=patreon, price=0 is valid."""
        update = ProductUpdate(
            category="patreon",
            price=Decimal("0"),
        )
        assert update.price == Decimal("0")

    def test_patreon_category_without_price_is_valid(self) -> None:
        """PATCH category=patreon only (no price) is valid.

        The update validator can only reject if BOTH category and price
        are provided in the same update and they conflict.
        """
        update = ProductUpdate(category="patreon")
        assert update.category == "patreon"
        assert update.price is None

    def test_ticket_category_with_nonzero_price_is_valid(self) -> None:
        """PATCH category=ticket, price=500 remains valid."""
        update = ProductUpdate(
            category="ticket",
            price=Decimal("500"),
        )
        assert update.price == Decimal("500")
