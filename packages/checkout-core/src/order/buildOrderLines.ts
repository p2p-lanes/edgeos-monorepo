// Order-line assembly: SelectionState → ProductLine[] for /preview and /purchase.
//
// This is the headless open-checkout counterpart of the portal's
// buildPaymentProducts.ts. The anonymous endpoints accept ONLY
// {product_id, quantity}, so this is far simpler than the authenticated path:
// no attendee_id, no unit_price_override (patron custom amount), no
// purchase_metadata (meal plans), no month-upgrade/credit logic. Those are
// deferred (see the CONTINUATION doc). The one non-trivial rule is housing:
// per-night products fold their night count into the quantity.

import type { ProductLine } from "../types/api"
import type { SelectionState } from "../selection/state"

/** The order quantity a housing selection contributes. */
export function housingLineQuantity(housing: {
  nights: number
  quantity: number
  pricePerNight: boolean
}): number {
  const base = housing.pricePerNight ? housing.nights : 1
  return base * housing.quantity
}

/**
 * Build the `{product_id, quantity}` lines for a selection. Quantities are
 * aggregated per product (so housing sharing a product id with a standard
 * selection sums rather than duplicating), first-seen order preserved. Zero /
 * negative quantities are dropped.
 */
export function buildOrderLines(state: SelectionState): ProductLine[] {
  const byProduct = new Map<string, number>()

  const add = (productId: string, quantity: number) => {
    if (quantity <= 0) return
    byProduct.set(productId, (byProduct.get(productId) ?? 0) + quantity)
  }

  for (const [productId, quantity] of Object.entries(state.quantities)) {
    add(productId, quantity)
  }

  if (state.housing) {
    add(state.housing.productId, housingLineQuantity(state.housing))
  }

  return Array.from(byProduct, ([product_id, quantity]) => ({
    product_id,
    quantity,
  }))
}
