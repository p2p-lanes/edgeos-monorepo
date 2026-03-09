import { useMemo } from "react"
import type {
  CheckoutCartSummary,
  SelectedHousingItem,
  SelectedMerchItem,
  SelectedPassItem,
  SelectedPatronItem,
} from "@/types/checkout"

interface UseCartSummaryParams {
  selectedPasses: SelectedPassItem[]
  housing: SelectedHousingItem | null
  merch: SelectedMerchItem[]
  patron: SelectedPatronItem | null
  insuranceAmount: number
  isEditing: boolean
  editCredit: number
  monthUpgradeCredit: number
  appCredit: string | number | null | undefined
}

export function useCartSummary({
  selectedPasses,
  housing,
  merch,
  patron,
  insuranceAmount,
  isEditing,
  editCredit,
  monthUpgradeCredit,
  appCredit,
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
    const insuranceSubtotal = insuranceAmount

    const subtotal =
      passesSubtotal +
      housingSubtotal +
      merchSubtotal +
      patronSubtotal +
      insuranceSubtotal
    const originalSubtotal =
      passesOriginalSubtotal +
      housingSubtotal +
      merchSubtotal +
      patronSubtotal +
      insuranceSubtotal
    const discount = originalSubtotal - subtotal
    const accountCredit = appCredit ? Number(appCredit) : 0
    const credit = isEditing
      ? editCredit + accountCredit
      : accountCredit + monthUpgradeCredit
    const grandTotal = Math.max(0, subtotal - credit)

    const itemCount =
      selectedPasses.length +
      (housing ? 1 : 0) +
      merch.length +
      (patron ? 1 : 0)

    return {
      passesSubtotal,
      housingSubtotal,
      merchSubtotal,
      patronSubtotal,
      insuranceSubtotal,
      subtotal: originalSubtotal,
      discount,
      credit,
      grandTotal,
      itemCount,
    }
  }, [
    selectedPasses,
    housing,
    merch,
    patron,
    insuranceAmount,
    isEditing,
    editCredit,
    monthUpgradeCredit,
    appCredit,
  ])

  return { summary }
}
