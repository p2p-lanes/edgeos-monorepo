// Pure SelectionState ↔ CartState mapping for persistence and restore.
//
// The headless core uses a flat product→quantity model. Cart lines preserve
// purchase intent without pretending generic products belong to a UI category.

import {
  emptySelection,
  type SelectionState,
  selectHousing,
  setCoupon,
  setInsurance,
} from "../selection/state"
import type { CartLine, CartState } from "../types/api"

export interface ToCartOptions {
  currentStep?: string | null
}

/** Serialize a selection into a CartState for `PUT /checkout/{slug}/{flowSlug}/cart`. */
export function selectionToCartState(
  selection: SelectionState,
  opts: ToCartOptions = {},
): CartState {
  const lines: CartLine[] = Object.entries(selection.quantities).map(
    ([product_id, quantity]) => ({
      kind: "product",
      assignment: { kind: "unassigned" },
      product_id,
      quantity,
    }),
  )
  if (selection.housing) {
    lines.push({
      kind: "date_range",
      assignment: { kind: "unassigned" },
      step_type: "housing",
      product_id: selection.housing.productId,
      check_in: selection.housing.checkIn,
      check_out: selection.housing.checkOut,
      quantity: 1,
    })
  }
  return {
    lines,
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

  for (const line of cart.lines ?? []) {
    if (line.kind === "product") add(line.product_id, line.quantity)
    if (line.kind === "custom_amount") add(line.product_id, 1)
  }

  let state: SelectionState = { ...emptySelection(), quantities }
  const housing = cart.lines?.find((line) => line.kind === "date_range")
  if (housing) {
    state = selectHousing(state, {
      productId: housing.product_id,
      checkIn: housing.check_in,
      checkOut: housing.check_out,
    })
  }
  state = setInsurance(state, !!cart.insurance)
  state = setCoupon(state, cart.promo_code ?? null)
  return state
}
