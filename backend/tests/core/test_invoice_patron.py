"""Unit tests for invoice PDF line-item pricing with patron products.

Spec: patron-product-rules — Phase 1.6
Requirement: effective_unit_price takes precedence over product_price for
patreon rows. Non-patreon rows use product_price unchanged.

Strategy: patch `app.core.invoice._format_fiat_amount` to capture the
unit_price argument passed in. This avoids PDF binary decoding and tests
the logic directly.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch


def _make_product_snapshot(
    *,
    product_name: str = "Test Item",
    product_price: Decimal = Decimal("0"),
    effective_unit_price: Decimal | None = None,
    quantity: int = 1,
    product_currency: str = "USD",
) -> MagicMock:
    pp = MagicMock()
    pp.product_name = product_name
    pp.product_price = product_price
    pp.effective_unit_price = effective_unit_price
    pp.quantity = quantity
    pp.product_currency = product_currency
    return pp


def _make_payment(products_snapshot: list[MagicMock]) -> MagicMock:
    payment = MagicMock()
    payment.id = uuid.uuid4()
    payment.external_id = "test-ext-001"
    payment.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    payment.amount = Decimal("5000")
    payment.insurance_amount = Decimal("0")
    payment.currency = "USD"
    payment.discount_value = None
    payment.products_snapshot = products_snapshot
    return payment


class TestInvoicePatronUnitPrice:
    """Patron line-items use effective_unit_price; non-patron use product_price."""

    def test_patreon_row_uses_effective_unit_price(self) -> None:
        """_format_fiat_amount is called with 5000.0 for a row with effective_unit_price=5000."""
        from app.core.invoice import generate_invoice_pdf

        pp = _make_product_snapshot(
            product_name="Patron",
            product_price=Decimal("0"),
            effective_unit_price=Decimal("5000"),
        )
        payment = _make_payment([pp])

        captured_unit_prices: list[float] = []

        original_format = __import__(
            "app.core.invoice", fromlist=["_format_fiat_amount"]
        )._format_fiat_amount

        def capturing_format(value: float, currency: str) -> str:
            captured_unit_prices.append(value)
            return original_format(value, currency)

        with patch(
            "app.core.invoice._format_fiat_amount", side_effect=capturing_format
        ):
            generate_invoice_pdf(
                payment,
                client_name="Test Client",
                invoice_company_name="Test Co",
                invoice_company_address="123 Main St",
                invoice_company_email="test@example.com",
            )

        # _format_fiat_amount is called for: unit_price, line_total, subtotal, total, discount.
        # The FIRST call is the unit_price column — must be 5000.0, not 0.0.
        assert captured_unit_prices, "No _format_fiat_amount calls captured"
        assert captured_unit_prices[0] == 5000.0, (
            f"First call (unit price) must be 5000.0 (effective_unit_price). "
            f"Got: {captured_unit_prices}"
        )

    def test_non_patreon_row_uses_product_price(self) -> None:
        """_format_fiat_amount is called with 3000.0 for a ticket row with product_price=3000."""
        from app.core.invoice import generate_invoice_pdf

        pp = _make_product_snapshot(
            product_name="General Admission",
            product_price=Decimal("3000"),
            effective_unit_price=None,
        )
        payment = _make_payment([pp])

        captured_unit_prices: list[float] = []
        original_format = __import__(
            "app.core.invoice", fromlist=["_format_fiat_amount"]
        )._format_fiat_amount

        def capturing_format(value: float, currency: str) -> str:
            captured_unit_prices.append(value)
            return original_format(value, currency)

        with patch(
            "app.core.invoice._format_fiat_amount", side_effect=capturing_format
        ):
            generate_invoice_pdf(
                payment,
                client_name="Test Client",
                invoice_company_name="Test Co",
                invoice_company_address="123 Main St",
                invoice_company_email="test@example.com",
            )

        assert 3000.0 in captured_unit_prices, (
            f"Expected 3000.0 in format calls. Got: {captured_unit_prices}"
        )

    def test_zero_effective_unit_price_is_not_or_trap(self) -> None:
        """effective_unit_price=0 must be used (not fall through to product_price).

        A naive `effective_unit_price or product_price` would skip Decimal('0')
        (falsy) and show product_price=999 instead. This locks the explicit
        `is not None` contract.
        """
        from app.core.invoice import generate_invoice_pdf

        pp = _make_product_snapshot(
            product_name="Free Patron",
            product_price=Decimal("999"),
            effective_unit_price=Decimal("0"),
        )
        payment = _make_payment([pp])

        captured_unit_prices: list[float] = []
        original_format = __import__(
            "app.core.invoice", fromlist=["_format_fiat_amount"]
        )._format_fiat_amount

        def capturing_format(value: float, currency: str) -> str:
            captured_unit_prices.append(value)
            return original_format(value, currency)

        with patch(
            "app.core.invoice._format_fiat_amount", side_effect=capturing_format
        ):
            generate_invoice_pdf(
                payment,
                client_name="Test Client",
                invoice_company_name="Test Co",
                invoice_company_address="123 Main St",
                invoice_company_email="test@example.com",
            )

        # Must show 0.0 (effective_unit_price=0), NOT 999.0 (product_price)
        assert 0.0 in captured_unit_prices, (
            f"Expected 0.0 (effective_unit_price) in format calls. Got: {captured_unit_prices}"
        )
        assert 999.0 not in captured_unit_prices, (
            f"product_price=999 must NOT appear. Got: {captured_unit_prices}"
        )
