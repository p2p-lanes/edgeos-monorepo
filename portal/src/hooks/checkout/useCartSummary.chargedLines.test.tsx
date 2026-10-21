import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type {
  SelectedDynamicItem,
  SelectedMerchItem,
  SelectedPassItem,
} from "@/types/checkout"
import { chargedLineAmount, useCartSummary } from "./useCartSummary"

describe("chargedLineAmount", () => {
  it("takes the discount off a discountable line", () => {
    expect(chargedLineAmount(463, { discountable: true }, 30)).toBeCloseTo(
      324.1,
    )
  })

  it("leaves non-discountable lines and the no-discount case alone", () => {
    expect(chargedLineAmount(463, { discountable: false }, 30)).toBe(463)
    expect(chargedLineAmount(463, { discountable: true }, 0)).toBe(463)
  })

  it("treats a line with no product (a booked room) as discountable", () => {
    expect(chargedLineAmount(100, null, 10)).toBeCloseTo(90)
  })
})

// The cart drawer prints one price per line and the total, with no discount
// row in between. That only reads right if the charged lines add up to the
// total the summary computes.
it("charged lines add up to the cart total", () => {
  const passes = [
    { originalPrice: 463, price: 324.1, product: { discountable: true } },
    { originalPrice: 463, price: 324.1, product: { discountable: true } },
    { originalPrice: 740, price: 518, product: { discountable: true } },
  ] as SelectedPassItem[]
  const merch = [
    { totalPrice: 40, product: { discountable: false } },
  ] as SelectedMerchItem[]
  const dynamicItems = {
    parking: [
      { price: 60, quantity: 2, product: { discountable: true } },
    ] as SelectedDynamicItem[],
  }
  const { result } = renderHook(() =>
    useCartSummary({
      selectedPasses: passes,
      housing: null,
      accommodations: [],
      merch,
      patron: null,
      mealPlans: [],
      dynamicItems,
      insuranceAmount: 0,
      contributionAmount: 0,
      isEditing: false,
      editCredit: 0,
      monthUpgradeCredit: 0,
      appCredit: 0,
      discountValue: 30,
    }),
  )
  const { summary } = result.current
  expect(summary.discountPercent).toBe(30)

  const lines = [
    ...passes.map((p) =>
      chargedLineAmount(
        p.originalPrice ?? p.price,
        p.product,
        summary.discountPercent,
      ),
    ),
    ...merch.map((m) =>
      chargedLineAmount(m.totalPrice, m.product, summary.discountPercent),
    ),
    ...dynamicItems.parking.map((d) =>
      chargedLineAmount(d.price, d.product, summary.discountPercent),
    ),
  ]
  const sum = lines.reduce((a, b) => a + b, 0)
  expect(sum).toBeCloseTo(summary.grandTotal)
  // 324.10 + 324.10 + 518 + 40 (not discountable) + 42
  expect(summary.grandTotal).toBeCloseTo(1248.2)
})
