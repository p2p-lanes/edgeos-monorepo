import { useMemo } from "react"
import type {
  CheckoutCartSummary,
  SelectedHousingItem,
  SelectedMealPlanItem,
  SelectedMerchItem,
  SelectedPassItem,
  SelectedPatronItem,
} from "@/types/checkout"

interface UseCartSummaryParams {
  selectedPasses: SelectedPassItem[]
  housing: SelectedHousingItem | null
  merch: SelectedMerchItem[]
  patron: SelectedPatronItem | null
  mealPlans: SelectedMealPlanItem[]
  insuranceAmount: number
  isEditing: boolean
  editCredit: number
  monthUpgradeCredit: number
  appCredit: string | number | null | undefined
  discountValue: number
}

export function useCartSummary({
  selectedPasses,
  housing,
  merch,
  patron,
  mealPlans,
  insuranceAmount,
  isEditing,
  editCredit,
  monthUpgradeCredit,
  appCredit,
  discountValue,
}: UseCartSummaryParams) {
  const summary = useMemo<CheckoutCartSummary>(() => {
    const passesSubtotal = selectedPasses.reduce((sum, p) => sum + p.price, 0)
    const passesOriginalSubtotal = selectedPasses.reduce(
      (sum, p) => sum + (p.originalPrice ?? p.price),
      0,
    )
    const housingSubtotal = housing?.totalPrice ?? 0
    const merchSubtotal = merch.reduce((sum, m) => sum + m.totalPrice, 0)
    const patronSubtotal = patron?.amount ?? 0
    // One meal-plan entry = one weekly product purchase. Price already on the
    // resolved product reference; sum across all (attendee × week) entries.
    const mealPlansSubtotal = mealPlans.reduce(
      (sum, m) => sum + (m.product?.price ?? 0),
      0,
    )
    const insuranceSubtotal = insuranceAmount

    const originalSubtotal =
      passesOriginalSubtotal +
      housingSubtotal +
      merchSubtotal +
      patronSubtotal +
      mealPlansSubtotal +
      insuranceSubtotal
    // Apply discount on the original subtotal so the result is idempotent even
    // if PassesProvider has already mutated pass prices via priceStrategy.
    const promoDiscount = (originalSubtotal * discountValue) / 100
    const discountedSubtotal = originalSubtotal - promoDiscount
    const accountCredit = appCredit ? Number(appCredit) : 0
    const credit = isEditing
      ? editCredit + accountCredit
      : accountCredit + monthUpgradeCredit
    const grandTotal = Math.max(0, discountedSubtotal - credit)

    const itemCount =
      selectedPasses.length +
      (housing ? 1 : 0) +
      merch.length +
      (patron ? 1 : 0) +
      mealPlans.length

    return {
      passesSubtotal,
      housingSubtotal,
      merchSubtotal,
      patronSubtotal,
      mealPlansSubtotal,
      insuranceSubtotal,
      dynamicSubtotal: 0,
      subtotal: originalSubtotal,
      discount: promoDiscount,
      credit,
      grandTotal,
      itemCount,
    }
  }, [
    selectedPasses,
    housing,
    merch,
    patron,
    mealPlans,
    insuranceAmount,
    isEditing,
    editCredit,
    monthUpgradeCredit,
    appCredit,
    discountValue,
  ])

  return { summary }
}
