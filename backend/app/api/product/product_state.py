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


def derive_product_state(
    product: Any,
    now: datetime | None = None,
) -> ProductSaleState:
    """Return the derived sale state for a product at the given instant.

    Args:
        product: Any object exposing ``sale_starts_at``, ``sale_ends_at``
                 (both ``datetime | None``) and ``total_stock_remaining``
                 (``int | None``). Accepts SQLModel ORM instances, Pydantic
                 response models, or plain duck-typed objects (e.g. test stubs).
        now:     The reference instant.  Defaults to ``datetime.now(UTC)``.

    Returns:
        A ``ProductSaleState`` enum value.

    Truth table:
        sale_starts_at  sale_ends_at  now relative to window  → state
        NULL            NULL          any                     → on_sale
        NULL            future        now < ends_at           → on_sale
        NULL            past          now >= ends_at          → ended
        future          any           now < starts_at         → upcoming
        past/now        NULL          —                       → on_sale
        past/now        future        now < ends_at           → on_sale
        any             past/now      now >= ends_at          → ended

    Stock override (applied after time evaluation):
        total_stock_remaining is NOT NULL AND <= 0             → sold_out
    """
    if now is None:
        now = datetime.now(UTC)

    starts: datetime | None = getattr(product, "sale_starts_at", None)
    ends: datetime | None = getattr(product, "sale_ends_at", None)
    stock: int | None = getattr(product, "total_stock_remaining", None)

    # ---- time-based state ----
    # 1. If end window has passed (exclusive upper bound), the sale is ended.
    if ends is not None and now >= ends:
        state = ProductSaleState.ended

    # 2. If start is in the future, the sale hasn't opened yet.
    elif starts is not None and now < starts:
        state = ProductSaleState.upcoming

    # 3. All remaining cases: either no window, or now is within the window.
    else:
        state = ProductSaleState.on_sale

    # ---- stock override (evaluated last, highest priority) ----
    if stock is not None and stock <= 0:
        state = ProductSaleState.sold_out

    return state
