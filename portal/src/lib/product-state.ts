import type { ProductPublic } from "@/client"

export type ProductSaleState = "upcoming" | "on_sale" | "ended" | "sold_out"

/** YYYY-MM-DD for "today" in UTC, built from native Date UTC accessors. */
const todayUtcYmd = (): string => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`
}

/**
 * Mirror of backend `derive_product_state` (see backend/app/api/product/product_state.py).
 *
 * Both ends of the sale window are inclusive: `sale_ends_at = "2026-01-10"`
 * keeps the product on sale through all of Jan 10 UTC. Comparisons are
 * lexicographic on YYYY-MM-DD strings (calendar order matches string order).
 */
export function deriveProductState(
  product: Pick<
    ProductPublic,
    | "sale_starts_at"
    | "sale_ends_at"
    | "total_stock_remaining"
    | "total_stock_cap"
  >,
  today: string = todayUtcYmd(),
): ProductSaleState {
  const cap = product.total_stock_cap ?? null
  const remaining = product.total_stock_remaining ?? null
  if (cap !== null && remaining !== null && remaining <= 0) {
    return "sold_out"
  }

  const { sale_starts_at, sale_ends_at } = product
  if (sale_ends_at && today > sale_ends_at) return "ended"
  if (sale_starts_at && today < sale_starts_at) return "upcoming"
  return "on_sale"
}
