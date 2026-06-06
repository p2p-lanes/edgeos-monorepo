"""Product sale-state derivation — pure helper.

Implements the truth table from spec capability product-sale-state.

Design: ADR-1 — state derivation is a pure function on Product.
No DB access, no popup coupling, no side effects.
"""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


class ProductSaleState(StrEnum):
    """Derived sale state for a product.

    Computed at read time from product-level sale window fields and stock.
    Never persisted.

    Priority rule (spec §product-sale-state):
        sold_out is evaluated LAST and overrides any time-based state.
    """

    upcoming = "upcoming"
    on_sale = "on_sale"
    ended = "ended"
    sold_out = "sold_out"


def _as_utc(dt: datetime | None) -> datetime | None:
    """Coerce a datetime to tz-aware UTC; naive values are assumed UTC."""
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def derive_product_state(
    product: Any,
    now: datetime | None = None,
) -> ProductSaleState:
    """Return the derived sale state for a product at the given instant.

    The sale window is evaluated as precise ``datetime`` instants (not whole
    days), so ``sale_ends_at`` can express a cutoff like "Friday 11:59:59 PM".
    Both bounds are inclusive: the product is on sale while
    ``sale_starts_at <= now <= sale_ends_at``.

    Args:
        product: Any object exposing ``sale_starts_at``, ``sale_ends_at``
                 (both ``datetime | None``) and ``total_stock_remaining``
                 (``int | None``). Naive datetimes are treated as UTC.
        now:     The reference instant. Defaults to ``datetime.now(UTC)``.

    Returns:
        A ``ProductSaleState`` enum value.

    Truth table:
        sale_starts_at  sale_ends_at  now relative to window  → state
        NULL            NULL          any                     → on_sale
        future          any           now < starts            → upcoming
        any             past          now > ends              → ended
        otherwise                                             → on_sale

    Stock override (applied after time evaluation):
        total_stock_remaining is NOT NULL AND <= 0            → sold_out
    """
    now = _as_utc(now) or datetime.now(UTC)

    starts = _as_utc(getattr(product, "sale_starts_at", None))
    ends = _as_utc(getattr(product, "sale_ends_at", None))
    stock: int | None = getattr(product, "total_stock_remaining", None)

    if ends is not None and now > ends:
        state = ProductSaleState.ended
    elif starts is not None and now < starts:
        state = ProductSaleState.upcoming
    else:
        state = ProductSaleState.on_sale

    if stock is not None and stock <= 0:
        state = ProductSaleState.sold_out

    return state
