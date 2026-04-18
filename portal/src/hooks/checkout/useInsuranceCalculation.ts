import { useMemo } from "react"
import type { InsurancePopupSource } from "@/checkout/insuranceUi"
import {
  buildCheckoutInsuranceSummary,
  isCheckoutInsuranceAvailable,
} from "@/checkout/insuranceUi"
import type {
  CheckoutInsuranceSummary,
  SelectedHousingItem,
  SelectedMerchItem,
  SelectedPassItem,
} from "@/types/checkout"

interface UseInsuranceCalculationParams {
  popup: InsurancePopupSource | null | undefined
  selectedPasses: SelectedPassItem[]
  housing: SelectedHousingItem | null
  merch: SelectedMerchItem[]
  insurance: boolean
}

interface UseInsuranceCalculationResult {
  insurancePotentialAmount: number
  insuranceAmount: number
  insuranceSummary: CheckoutInsuranceSummary
}

/**
 * Calculates insurance costs using popup-level rate and product-level eligibility.
 *
 * - Uses `popup.insurance_percentage` as the sole rate (no 5% fallback).
 * - Filters cart items by `product.insurance_eligible`.
 * - Returns 0 for both amounts when popup insurance is disabled or percentage
 *   is null/zero.
 * - The `insurance` boolean gates `insuranceAmount` (user opt-in toggle).
 *   `insurancePotentialAmount` always reflects the full eligible amount regardless
 *   of the toggle (used for UI preview on the confirm step).
 */
export function useInsuranceCalculation({
  popup,
  selectedPasses,
  housing,
  merch,
  insurance,
}: UseInsuranceCalculationParams): UseInsuranceCalculationResult {
  const isAvailable = useMemo(
    () => isCheckoutInsuranceAvailable(popup),
    [popup],
  )

  const insuranceSummary = useMemo<CheckoutInsuranceSummary>(() => {
    if (!isAvailable) {
      return {
        enabled: false,
        percentage: null,
        amount: 0,
        eligibleProductIds: [],
      }
    }
    return buildCheckoutInsuranceSummary(popup, {
      passes: selectedPasses,
      housing,
      merch,
    })
  }, [isAvailable, popup, selectedPasses, housing, merch])

  const insurancePotentialAmount = insuranceSummary.amount

  const insuranceAmount = useMemo(() => {
    if (!insurance) return 0
    return insurancePotentialAmount
  }, [insurance, insurancePotentialAmount])

  return { insurancePotentialAmount, insuranceAmount, insuranceSummary }
}
