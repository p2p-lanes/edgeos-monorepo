"""Product sale-state derivation — pure helper.

Implements the truth table from spec capability product-sale-state.

Design: ADR-1 — state derivation is a pure function on Product.
No DB access, no popup coupling, no side effects.
"""

from datetime import UTC, date, datetime
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


def derive_product_state(
    product: Any,
    today: date | None = None,
) -> ProductSaleState:
    """Return the derived sale state for a product on the given UTC day.

    Args:
        product: Any object exposing ``sale_starts_at``, ``sale_ends_at``
                 (both ``date | None``, the *inclusive* sale window) and
                 ``total_stock_remaining`` (``int | None``).
        today:   The reference UTC date. Defaults to ``datetime.now(UTC).date()``.

    Returns:
        A ``ProductSaleState`` enum value.

    Truth table (both ends inclusive):
        sale_starts_at  sale_ends_at  today relative to window  → state
        NULL            NULL          any                       → on_sale
        future          any           today < starts            → upcoming
        any             past          today > ends              → ended
        otherwise                                               → on_sale

    Stock override (applied after time evaluation):
        total_stock_remaining is NOT NULL AND <= 0              → sold_out
    """
    if today is None:
        today = datetime.now(UTC).date()

    starts: date | None = getattr(product, "sale_starts_at", None)
    ends: date | None = getattr(product, "sale_ends_at", None)
    stock: int | None = getattr(product, "total_stock_remaining", None)

    if ends is not None and today > ends:
        state = ProductSaleState.ended
    elif starts is not None and today < starts:
        state = ProductSaleState.upcoming
    else:
        state = ProductSaleState.on_sale

    if stock is not None and stock <= 0:
        state = ProductSaleState.sold_out

    return state
