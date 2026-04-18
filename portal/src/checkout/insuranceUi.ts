import type { PopupPublic, ProductPublic } from "@/client"
import type {
  CheckoutInsuranceSummary,
  SelectedHousingItem,
  SelectedMerchItem,
  SelectedPassItem,
} from "@/types/checkout"

/**
 * Insurance UI helpers — pure functions consuming popup-level insurance config.
 *
 * Popup is the single source of truth for insurance rate and activation.
 * Product-level `insurance_eligible` opt-in flag controls which cart items
 * are included in the calculation.
 *
 * Mirrors the seam established by `popupCheckoutPolicy.ts` (Feature 3).
 */

export type InsurancePopupSource = Pick<
  PopupPublic,
  "insurance_enabled" | "insurance_percentage"
>

export type InsuranceProductSource = Pick<
  ProductPublic,
  "id" | "insurance_eligible"
>

/**
 * Returns true if the popup has insurance enabled with a valid positive
 * percentage. Both conditions must be satisfied — a popup with
 * `insurance_enabled=true` but `insurance_percentage=null` is not available
 * (edge case: data inconsistency post-migration, guard per POPUP-6).
 */
export function isCheckoutInsuranceAvailable(
  popup: InsurancePopupSource | null | undefined,
): boolean {
  if (!popup?.insurance_enabled) return false
  const pct = Number(popup.insurance_percentage)
  return !Number.isNaN(pct) && pct > 0
}

/**
 * Calculate the insurance amount for an eligible subtotal.
 *
 * Returns 0 if popup insurance is not available or the subtotal is 0.
 */
export function getCheckoutInsuranceAmount(
  popup: InsurancePopupSource | null | undefined,
  eligibleSubtotal: number,
): number {
  if (!isCheckoutInsuranceAvailable(popup)) return 0
  const pct = Number(popup!.insurance_percentage)
  return (eligibleSubtotal * pct) / 100
}

/**
 * Build a `CheckoutInsuranceSummary` from the popup and the current cart state.
 *
 * Only products whose `insurance_eligible=true` are included in the eligible
 * subtotal. The 5% legacy fallback is deliberately absent — if a product has
 * no `insurance_eligible` flag (or it is false/undefined) it is excluded.
 */
export function buildCheckoutInsuranceSummary(
  popup: InsurancePopupSource | null | undefined,
  cart: {
    passes: Array<SelectedPassItem>
    housing: SelectedHousingItem | null
    merch: Array<SelectedMerchItem>
  },
): CheckoutInsuranceSummary {
  const available = isCheckoutInsuranceAvailable(popup)
  const percentage = available ? Number(popup!.insurance_percentage) : null

  const eligibleProductIds: string[] = []
  let eligibleSubtotal = 0

  if (available) {
    for (const pass of cart.passes) {
      if (pass.product.insurance_eligible) {
        eligibleProductIds.push(pass.product.id)
        eligibleSubtotal += (pass.originalPrice ?? pass.price) * pass.quantity
      }
    }

    if (cart.housing?.product.insurance_eligible) {
      eligibleProductIds.push(cart.housing.product.id)
      eligibleSubtotal += cart.housing.totalPrice
    }

    for (const item of cart.merch) {
      if (item.product.insurance_eligible) {
        eligibleProductIds.push(item.product.id)
        eligibleSubtotal += item.totalPrice
      }
    }
  }

  const amount = getCheckoutInsuranceAmount(popup, eligibleSubtotal)

  return {
    enabled: available,
    percentage,
    amount,
    eligibleProductIds,
  }
}
