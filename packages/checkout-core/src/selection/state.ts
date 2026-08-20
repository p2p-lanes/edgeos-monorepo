// The headless open-checkout selection model + pure reducers.
//
// SCOPE (v1, per user decision 2026-07-29): the anonymous /purchase + /preview
// endpoints accept only ProductLine = {product_id, quantity}. So selection is
// modeled as product quantities (tickets, merch, dynamic, fixed-price patron)
// plus date-driven housing. DEFERRED to a future backend enabler and
// deliberately NOT modeled here (no dead fields): patron custom amount
// (unit_price_override), meal-plan metadata (purchase_metadata), and per-attendee
// assignment (attendee_id). See the CONTINUATION doc.
//
// Every function is pure and returns a NEW state — no mutation, no React.

/**
 * A date-driven housing selection. Kept separate from `quantities` so the
 * chosen dates survive cart persistence and so per-night pricing can fold the
 * night count into the order-line quantity (Task 2.5).
 */
export interface HousingSelection {
  productId: string
  /** ISO date "YYYY-MM-DD". */
  checkIn: string
  /** ISO date "YYYY-MM-DD". */
  checkOut: string
  /** Derived night count (>= 1). */
  nights: number
  /** Units of this housing product (>= 1). */
  quantity: number
  /** When true the product is priced per night (order qty = nights * quantity). */
  pricePerNight: boolean
}

export interface SelectionState {
  /** productId → quantity for standard product steps (tickets, merch, dynamic). */
  quantities: Record<string, number>
  /** The single housing selection, if any (mirrors the cart's one-housing rule). */
  housing: HousingSelection | null
  /** Buyer opt-in for the optional insurance fee. */
  insurance: boolean
  /** Applied coupon code, if any. */
  couponCode: string | null
}

/** A fresh, empty selection. */
export function emptySelection(): SelectionState {
  return { quantities: {}, housing: null, insurance: false, couponCode: null }
}

const DAY_MS = 1000 * 60 * 60 * 24

/**
 * Nights between two ISO dates, floored at 1. Mirrors the portal's
 * `useHousingSelection.computeNights` exactly.
 */
export function computeNights(checkIn: string, checkOut: string): number {
  const start = new Date(checkIn)
  const end = new Date(checkOut)
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS))
}

/**
 * Set the quantity for a product. A quantity of 0 or less removes it entirely
 * (open checkout has no zero-quantity rows — matches the portal's dynamic-item
 * remove-on-zero behavior).
 */
export function setQuantity(
  state: SelectionState,
  productId: string,
  quantity: number,
): SelectionState {
  const next = { ...state.quantities }
  if (quantity <= 0) {
    delete next[productId]
  } else {
    next[productId] = quantity
  }
  return { ...state, quantities: next }
}

/**
 * Toggle a product's presence: select one when absent/zero, remove when already
 * selected. Mirrors the portal's non-stepper toggle for dynamic items.
 */
export function toggleProduct(
  state: SelectionState,
  productId: string,
): SelectionState {
  const current = state.quantities[productId] ?? 0
  return setQuantity(state, productId, current > 0 ? 0 : 1)
}

export interface HousingInput {
  productId: string
  checkIn: string
  checkOut: string
  /** Defaults to true (priced per night), matching the portal default. */
  pricePerNight?: boolean
  /** Defaults to 1, or preserves the prior quantity when re-selecting the same product. */
  quantity?: number
}

/**
 * Select (or re-select) housing. Re-selecting the SAME product — e.g. only
 * changing dates — preserves the current quantity, matching the portal.
 */
export function selectHousing(
  state: SelectionState,
  input: HousingInput,
): SelectionState {
  const nights = computeNights(input.checkIn, input.checkOut)
  const sameProduct = state.housing?.productId === input.productId
  const quantity =
    input.quantity ?? (sameProduct ? (state.housing?.quantity ?? 1) : 1)
  return {
    ...state,
    housing: {
      productId: input.productId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights,
      quantity: Math.max(1, quantity),
      pricePerNight: input.pricePerNight ?? true,
    },
  }
}

/** Change the housing unit count. A count of 0 or less clears the housing. */
export function setHousingQuantity(
  state: SelectionState,
  quantity: number,
): SelectionState {
  if (!state.housing) return state
  if (quantity <= 0) return { ...state, housing: null }
  return { ...state, housing: { ...state.housing, quantity } }
}

export function clearHousing(state: SelectionState): SelectionState {
  if (!state.housing) return state
  return { ...state, housing: null }
}

export function setInsurance(
  state: SelectionState,
  insurance: boolean,
): SelectionState {
  return { ...state, insurance }
}

export function setCoupon(
  state: SelectionState,
  couponCode: string | null,
): SelectionState {
  return { ...state, couponCode }
}

/** Total number of individual units selected (products + housing units). */
export function totalSelectedQuantity(state: SelectionState): number {
  let total = 0
  for (const qty of Object.values(state.quantities)) total += qty
  if (state.housing) total += state.housing.quantity
  return total
}

/** Whether anything at all is selected — used for step gating. */
export function hasAnySelection(state: SelectionState): boolean {
  return Object.keys(state.quantities).length > 0 || state.housing !== null
}
