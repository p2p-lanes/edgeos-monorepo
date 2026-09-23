import { renderHook } from "@testing-library/react"
import { expect, it } from "vitest"
import type { SelectedPassItem } from "@/types/checkout"
import { useCartSummary } from "./useCartSummary"

it("applies the scholarship once to the catalog price in the cart total", () => {
  const pass = {
    price: 647.5,
    originalPrice: 925,
    quantity: 1,
    product: { discountable: true },
  } as SelectedPassItem
  const { result } = renderHook(() =>
    useCartSummary({
      selectedPasses: [pass],
      housing: null,
      accommodations: [],
      merch: [],
      patron: null,
      mealPlans: [],
      dynamicItems: {},
      insuranceAmount: 0,
      contributionAmount: 0,
      isEditing: false,
      editCredit: 0,
      monthUpgradeCredit: 0,
      appCredit: 0,
      discountValue: 30,
    }),
  )
  expect(result.current.summary.subtotal).toBe(925)
  expect(result.current.summary.discount).toBe(277.5)
  expect(result.current.summary.grandTotal).toBe(647.5)
})
