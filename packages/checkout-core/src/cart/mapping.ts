// Pure SelectionState ↔ CartState mapping for persistence and restore.
//
// The headless core uses a flat product→quantity model, so on SAVE every
// selected product goes into the cart's generic `merch` bucket (for the
// anonymous flow a product is just product+quantity — the category split the
// authenticated portal needs does not apply). On RESTORE, products from ANY
// bucket (merch/passes/patron) are merged back into quantities, so a cart
// written by either flow hydrates cleanly. Housing keeps its dates (the backend
// CartItemHousing carries no quantity, so units default to 1 on restore).

import {
  emptySelection,
  selectHousing,
  type SelectionState,
  setCoupon,
  setInsurance,
} from "../selection/state"
import type { CartState } from "../types/api"

export interface ToCartOptions {
  currentStep?: string | null
}

/** Serialize a selection into a CartState for `PUT /checkout/{slug}/cart`. */
export function selectionToCartState(
  selection: SelectionState,
  opts: ToCartOptions = {},
): CartState {
  return {
    passes: [],
    housing: selection.housing
      ? {
          product_id: selection.housing.productId,
          check_in: selection.housing.checkIn,
          check_out: selection.housing.checkOut,
        }
      : null,
    merch: Object.entries(selection.quantities).map(
      ([product_id, quantity]) => ({ product_id, quantity }),
    ),
    patron: null,
    meal_plans: [],
    promo_code: selection.couponCode ?? null,
    insurance: selection.insurance,
    current_step: opts.currentStep ?? null,
  }
}

/** Rebuild a selection from a restored CartState. */
export function cartStateToSelection(cart: CartState): SelectionState {
  const quantities: Record<string, number> = {}
  const add = (productId: string, quantity: number) => {
    if (quantity <= 0) return
    quantities[productId] = (quantities[productId] ?? 0) + quantity
  }

  for (const m of cart.merch ?? []) add(m.product_id, m.quantity)
  for (const p of cart.passes ?? []) add(p.product_id, p.quantity)
  if (cart.patron) add(cart.patron.product_id, 1)

  let state: SelectionState = { ...emptySelection(), quantities }
  if (cart.housing) {
    state = selectHousing(state, {
      productId: cart.housing.product_id,
      checkIn: cart.housing.check_in,
      checkOut: cart.housing.check_out,
    })
  }
  state = setInsurance(state, !!cart.insurance)
  state = setCoupon(state, cart.promo_code ?? null)
  return state
}
