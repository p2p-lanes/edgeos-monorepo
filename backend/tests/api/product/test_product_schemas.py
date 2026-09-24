"""Unit tests for ProductCreate/ProductUpdate patreon price coercion validator.

Spec: patron-product Requirement: Patreon Price Coercion
"""

import uuid
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.api.product.schemas import ProductBatchItem, ProductCreate, ProductUpdate


@pytest.mark.parametrize(
    ("schema", "payload"),
    [
        (ProductCreate, {"popup_id": uuid.uuid4(), "name": "Ticket", "price": 10}),
        (ProductUpdate, {"name": "Renamed"}),
    ],
)
def test_product_writes_reject_fulfillment_type(schema, payload) -> None:
    with pytest.raises(ValidationError) as error:
        schema(**payload, fulfillment_type="access")
    assert error.value.errors()[0]["type"] == "extra_forbidden"


@pytest.mark.parametrize("category", ["", " ", "  \t  "])
@pytest.mark.parametrize("schema", [ProductCreate, ProductUpdate, ProductBatchItem])
def test_product_write_rejects_blank_category(schema, category: str) -> None:
    payload = {"category": category}
    if schema is not ProductUpdate:
        payload.update(name="Lunch", price=Decimal("10"))
    if schema is ProductCreate:
        payload["popup_id"] = uuid.uuid4()
    with pytest.raises(ValidationError) as exc_info:
        schema(**payload)
    assert any(error["loc"] == ("category",) for error in exc_info.value.errors())


def test_product_update_allows_omitted_or_null_category() -> None:
    assert "category" not in ProductUpdate(name="Lunch").model_fields_set
    assert ProductUpdate(category=None).category is None


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
