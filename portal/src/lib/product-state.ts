import type { ProductPublic } from "@/client"

export type ProductSaleState = "upcoming" | "on_sale" | "ended" | "sold_out"

/**
 * Mirror of backend `derive_product_state` (see backend/app/api/product/product_state.py).
 *
 * The sale window is evaluated as precise datetime instants (not whole days),
 * so `sale_ends_at` can express a cutoff like "Friday 11:59 PM". Both bounds
 * are inclusive: the product stays on sale while
 * `sale_starts_at <= now <= sale_ends_at`.
 *
 * Comparing absolute instants is timezone-safe — the stored values are UTC and
 * `Date.parse` yields an absolute epoch, so the browser timezone never leaks
 * into the result.
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
  const cap = product.total_stock_cap ?? null
  const remaining = product.total_stock_remaining ?? null
  if (cap !== null && remaining !== null && remaining <= 0) {
    return "sold_out"
  }

  const nowMs = now.getTime()
  const endsMs = product.sale_ends_at ? Date.parse(product.sale_ends_at) : null
  const startsMs = product.sale_starts_at
    ? Date.parse(product.sale_starts_at)
    : null

  if (endsMs !== null && nowMs > endsMs) return "ended"
  if (startsMs !== null && nowMs < startsMs) return "upcoming"
  return "on_sale"
}
