import { useCallback, useMemo } from "react"
import type {
  SelectedHousingItem,
  SelectedMerchItem,
  SelectedPassItem,
} from "@/types/checkout"

interface UseInsuranceCalculationParams {
  selectedPasses: SelectedPassItem[]
  housing: SelectedHousingItem | null
  merch: SelectedMerchItem[]
  insurance: boolean
}

export function useInsuranceCalculation({
  selectedPasses,
  housing,
  merch,
  insurance,
}: UseInsuranceCalculationParams) {
  const calculateInsuranceAmount = useCallback(
    (
      passes: SelectedPassItem[],
      housingItem: SelectedHousingItem | null,
      merchItems: SelectedMerchItem[],
    ): number => {
      const DEFAULT_INSURANCE_PCT = 5
      let total = 0

      for (const pass of passes) {
        const pct =
          Number(pass.product.insurance_percentage) || DEFAULT_INSURANCE_PCT
        const basePrice = pass.originalPrice ?? pass.price
        total += (basePrice * pct) / 100
      }

      if (housingItem) {
        const pct =
          Number(housingItem.product.insurance_percentage) ||
          DEFAULT_INSURANCE_PCT
        total += (housingItem.totalPrice * pct) / 100
      }

      for (const item of merchItems) {
        const pct =
          Number(item.product.insurance_percentage) || DEFAULT_INSURANCE_PCT
        total += (item.totalPrice * pct) / 100
      }

      return total
    },
    [],
  )

  const insurancePotentialAmount = useMemo(
    () => calculateInsuranceAmount(selectedPasses, housing, merch),
    [selectedPasses, housing, merch, calculateInsuranceAmount],
  )

  const insuranceAmount = useMemo(() => {
    if (!insurance) return 0
    return insurancePotentialAmount
  }, [insurance, insurancePotentialAmount])

  return { insurancePotentialAmount, insuranceAmount }
}
