import type { ProductPublic } from "@/client"

export type ProductSaleState = "upcoming" | "on_sale" | "ended" | "sold_out"

/**
 * Mirror of backend `derive_product_state` (see backend/app/api/product/product_state.py).
 *
 * Reads only sale_starts_at, sale_ends_at, and stock state. Does NOT read popup
 * fields. Sold-out always wins when stock is exhausted.
 *
 * Note: the portal Product type uses total_stock_cap + total_stock_remaining
 * (not max_quantity); sold_out fires when a cap is set and remaining <= 0.
 */
export function deriveProductState(
  product: Pick<
    ProductPublic,
    | "sale_starts_at"
    | "sale_ends_at"
    | "total_stock_remaining"
    | "total_stock_cap"
  >,
  now: Date = new Date(),
): ProductSaleState {
  // Determine sold_out first (overrides time-based state).
  const cap = product.total_stock_cap ?? null
  const remaining = product.total_stock_remaining ?? null
  if (cap !== null && remaining !== null && remaining <= 0) {
    return "sold_out"
  }

  const starts = product.sale_starts_at
    ? new Date(product.sale_starts_at)
    : null
  const ends = product.sale_ends_at ? new Date(product.sale_ends_at) : null

  if (starts === null && ends === null) return "on_sale"
  if (starts !== null && now < starts) return "upcoming"
  if (ends !== null && now >= ends) return "ended"
  return "on_sale"
}
