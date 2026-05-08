"""Unit tests for derive_product_state — truth table coverage.

TDD phase: RED-then-GREEN following the spec capability product-sale-state.

Truth table (spec §product-sale-state):
  | sale_starts_at | sale_ends_at | now relative        | expected  |
  |----------------|--------------|---------------------|-----------|
  | NULL           | NULL         | any                 | on_sale   |
  | NULL           | future       | now < ends_at       | on_sale   |
  | NULL           | past         | now >= ends_at      | ended     |
  | future         | NULL         | now < starts_at     | upcoming  |
  | future         | future       | now < starts_at     | upcoming  |
  | past           | NULL         | now >= starts_at    | on_sale   |
  | past           | future       | within window       | on_sale   |
  | past           | past         | now >= ends_at      | ended     |
  | exact lower    | future       | now == starts_at    | on_sale   |  (inclusive)
  | past           | exact upper  | now == ends_at      | ended     |  (exclusive)
  | past           | future       | within + stock=0    | sold_out  |  (stock overrides)
  | future         | future       | upcoming + stock=0  | sold_out  |  (stock overrides)

ADR-1: sold_out is NOT in the enum for time-based derivation; stock semantics are
a separate concern. But per spec, sold_out IS returned when stock_remaining <= 0
regardless of time window. The function reads total_stock_remaining from the product.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from app.api.product.product_state import ProductSaleState, derive_product_state

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

NOW = datetime(2026, 6, 15, 12, 0, 0, tzinfo=UTC)
PAST = NOW - timedelta(days=30)
FUTURE = NOW + timedelta(days=30)


def _product(
    sale_starts_at: datetime | None = None,
    sale_ends_at: datetime | None = None,
    total_stock_remaining: int | None = None,
) -> Any:
    """Return a minimal object with the fields derive_product_state reads."""

    class _Prod:
        pass

    p = _Prod()
    p.sale_starts_at = sale_starts_at
    p.sale_ends_at = sale_ends_at
    p.total_stock_remaining = total_stock_remaining
    return p


# ---------------------------------------------------------------------------
# Time-based truth table
# ---------------------------------------------------------------------------


class TestDeriveProductStateTruthTable:
    """Covers every (sale_starts_at, sale_ends_at) combination from the spec."""

    def test_both_null_returns_on_sale(self) -> None:
        """NULL/NULL → on_sale (OQ1 locked — null-both defaults to open)."""
        p = _product(sale_starts_at=None, sale_ends_at=None)
        assert derive_product_state(p, NOW) == ProductSaleState.on_sale

    def test_null_starts_future_ends_returns_on_sale(self) -> None:
        """NULL start, future end → on_sale (sale has started, not yet ended)."""
        p = _product(sale_starts_at=None, sale_ends_at=FUTURE)
        assert derive_product_state(p, NOW) == ProductSaleState.on_sale

    def test_null_starts_past_ends_returns_ended(self) -> None:
        """NULL start, past end → ended (window closed)."""
        p = _product(sale_starts_at=None, sale_ends_at=PAST)
        assert derive_product_state(p, NOW) == ProductSaleState.ended

    def test_future_starts_null_ends_returns_upcoming(self) -> None:
        """Future start, NULL end → upcoming (window not yet open)."""
        p = _product(sale_starts_at=FUTURE, sale_ends_at=None)
        assert derive_product_state(p, NOW) == ProductSaleState.upcoming

    def test_future_starts_future_ends_returns_upcoming(self) -> None:
        """Both future → upcoming (now is before the window)."""
        p = _product(sale_starts_at=FUTURE, sale_ends_at=FUTURE + timedelta(days=10))
        assert derive_product_state(p, NOW) == ProductSaleState.upcoming

    def test_past_starts_null_ends_returns_on_sale(self) -> None:
        """Past start, NULL end → on_sale (window open, no close)."""
        p = _product(sale_starts_at=PAST, sale_ends_at=None)
        assert derive_product_state(p, NOW) == ProductSaleState.on_sale

    def test_past_starts_future_ends_returns_on_sale(self) -> None:
        """Past start, future end → on_sale (within the window)."""
        p = _product(sale_starts_at=PAST, sale_ends_at=FUTURE)
        assert derive_product_state(p, NOW) == ProductSaleState.on_sale

    def test_past_starts_past_ends_returns_ended(self) -> None:
        """Both past → ended (window already closed)."""
        p = _product(sale_starts_at=PAST, sale_ends_at=PAST + timedelta(days=1))
        assert derive_product_state(p, NOW) == ProductSaleState.ended

    def test_exact_lower_bound_is_inclusive(self) -> None:
        """now == sale_starts_at → on_sale (inclusive lower bound)."""
        p = _product(sale_starts_at=NOW, sale_ends_at=FUTURE)
        assert derive_product_state(p, NOW) == ProductSaleState.on_sale

    def test_exact_upper_bound_is_exclusive(self) -> None:
        """now == sale_ends_at → ended (exclusive upper bound)."""
        p = _product(sale_starts_at=PAST, sale_ends_at=NOW)
        assert derive_product_state(p, NOW) == ProductSaleState.ended


# ---------------------------------------------------------------------------
# Stock exhaustion overrides time window (evaluated last, highest priority)
# ---------------------------------------------------------------------------


class TestDeriveProductStateSoldOut:
    """sold_out overrides any time-based state when total_stock_remaining <= 0."""

    def test_stock_zero_overrides_on_sale(self) -> None:
        """Within window but stock=0 → sold_out."""
        p = _product(sale_starts_at=PAST, sale_ends_at=FUTURE, total_stock_remaining=0)
        assert derive_product_state(p, NOW) == ProductSaleState.sold_out

    def test_stock_zero_overrides_upcoming(self) -> None:
        """Upcoming but stock=0 → sold_out."""
        p = _product(sale_starts_at=FUTURE, sale_ends_at=None, total_stock_remaining=0)
        assert derive_product_state(p, NOW) == ProductSaleState.sold_out

    def test_stock_negative_overrides_on_sale(self) -> None:
        """Negative stock (over-sold edge case) → sold_out."""
        p = _product(sale_starts_at=PAST, sale_ends_at=FUTURE, total_stock_remaining=-1)
        assert derive_product_state(p, NOW) == ProductSaleState.sold_out

    def test_null_stock_does_not_trigger_sold_out(self) -> None:
        """NULL total_stock_remaining → unlimited; no sold_out override."""
        p = _product(sale_starts_at=PAST, sale_ends_at=FUTURE, total_stock_remaining=None)
        assert derive_product_state(p, NOW) == ProductSaleState.on_sale

    def test_positive_stock_does_not_trigger_sold_out(self) -> None:
        """Positive stock → time window governs normally."""
        p = _product(sale_starts_at=PAST, sale_ends_at=FUTURE, total_stock_remaining=1)
        assert derive_product_state(p, NOW) == ProductSaleState.on_sale


# ---------------------------------------------------------------------------
# Default now=None uses datetime.now(UTC)
# ---------------------------------------------------------------------------


class TestDeriveProductStateDefaultNow:
    def test_default_now_resolves_to_utc(self) -> None:
        """Calling without now= argument must not raise and must return a valid state."""
        p = _product(sale_starts_at=None, sale_ends_at=None)
        result = derive_product_state(p)
        assert result in iter(ProductSaleState)


# ---------------------------------------------------------------------------
# Enum membership
# ---------------------------------------------------------------------------


class TestProductSaleStateEnum:
    def test_enum_has_exactly_four_values(self) -> None:
        """ProductSaleState must define upcoming, on_sale, ended, sold_out."""
        values = {s.value for s in ProductSaleState}
        assert values == {"upcoming", "on_sale", "ended", "sold_out"}

    def test_enum_values_are_strings(self) -> None:
        """ProductSaleState must be a StrEnum (values usable as plain strings)."""
        assert str(ProductSaleState.on_sale) == "on_sale"
        assert str(ProductSaleState.upcoming) == "upcoming"
        assert str(ProductSaleState.ended) == "ended"
        assert str(ProductSaleState.sold_out) == "sold_out"
