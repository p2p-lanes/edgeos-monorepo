import type { ProductPublic } from "@/client"
import { resolveMaxQuantity } from "@/components/ui/QuantitySelector"
import { deriveProductState, type ProductSaleState } from "@/lib/product-state"

export type AvailabilityProduct = Pick<
  ProductPublic,
  | "sale_starts_at"
  | "sale_ends_at"
  | "total_stock_cap"
  | "total_stock_remaining"
  | "max_per_order"
  | "sold_out_override"
>

export interface ProductAvailability {
  state: ProductSaleState
  canSelect: boolean
  maxAllowedQuantity: number
}

/**
 * Single source of truth for whether a product can be added to the cart and
 * how many units the UI is allowed to offer. Combines the derived sale state
 * (upcoming / ended / sold_out / on_sale) with the per-order + remaining-stock
 * caps so every variant and every cart hook gates the user identically.
 *
 * - `canSelect = false` for any state other than `on_sale` (covers sold_out,
 *   upcoming, ended).
 * - `maxAllowedQuantity = 0` whenever the product can't be selected.
 */
export function getProductAvailability(
  product: AvailabilityProduct,
  now?: Date,
): ProductAvailability {
  const state = deriveProductState(product, now)
  const canSelect = state === "on_sale"
  const maxAllowedQuantity = canSelect ? resolveMaxQuantity(product) : 0
  return { state, canSelect, maxAllowedQuantity }
}

export function isProductSoldOut(product: AvailabilityProduct): boolean {
  return getProductAvailability(product).state === "sold_out"
}
