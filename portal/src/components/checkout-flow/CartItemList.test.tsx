/**
 * The cart drawer has no Subtotal or Discount rows, only the lines and the
 * total in the footer. Lines used to show the full price while the total was
 * discounted ($463 + $463 + $740 listed against a $1,166.20 total), so the
 * drawer never added up. Each line now shows what it is charged, with the
 * full price struck through beside it.
 */

import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialCartState } from "@/types/checkout"
import CartItemList from "./CartItemList"

// `any` mirrors the ConfirmStep test: the real item types carry many fields
// this component never reads.
let cart: any
let summary: Record<string, number>

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    cart,
    summary,
    attendees: [{ id: "a1", name: "Ada" }],
    togglePass: vi.fn(),
    resetDayProduct: vi.fn(),
    clearHousing: vi.fn(),
    removeAccommodation: vi.fn(),
    updateMerchQuantity: vi.fn(),
    clearPatron: vi.fn(),
    removeMealPlan: vi.fn(),
    clearPromoCode: vi.fn(),
    removeDynamicItem: vi.fn(),
    isEditing: false,
    stepConfigs: [],
    flowConfig: null,
  }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function pass(id: string, name: string, catalog: number, discountable = true) {
  return {
    attendeeId: "a1",
    productId: id,
    quantity: 1,
    price: discountable ? catalog * 0.7 : catalog,
    originalPrice: catalog,
    product: { id, name, duration_type: "week", discountable },
  }
}

beforeEach(() => {
  cart = { ...createInitialCartState() }
  summary = {
    itemCount: 0,
    insuranceSubtotal: 0,
    contributionSubtotal: 0,
    creditApplied: 0,
    discountPercent: 0,
  }
})

describe("pass lines", () => {
  it("show the discounted price, with the full price struck through", () => {
    cart.passes = [
      pass("w1", "Week 1", 463),
      pass("w2", "Week 2", 463),
      pass("full", "Full", 740),
    ]
    summary = { ...summary, itemCount: 3, discountPercent: 30 }
    render(<CartItemList />)

    // 324.10 + 324.10 + 518.00 = 1,166.20, the total the footer shows.
    expect(screen.getAllByText("$324.10")).toHaveLength(2)
    expect(screen.getByText("$518.00")).toBeTruthy()
    const struck = screen.getAllByText(/^\$(463|740)\.00$/)
    expect(struck).toHaveLength(3)
    for (const el of struck) {
      expect(el.className).toContain("line-through")
    }
  })

  it("keep a non-discountable product at its full price", () => {
    cart.passes = [pass("p", "Patron pass", 500, false)]
    summary = { ...summary, itemCount: 1, discountPercent: 30 }
    render(<CartItemList />)

    const price = screen.getByText("$500.00")
    expect(price.className).not.toContain("line-through")
    expect(screen.getAllByText(/\$/)).toHaveLength(1)
  })

  it("show a single price when nothing is discounted", () => {
    cart.passes = [pass("w1", "Week 1", 463)]
    cart.passes[0].price = 463
    summary = { ...summary, itemCount: 1 }
    render(<CartItemList />)

    expect(screen.getAllByText(/\$/).map((el) => el.textContent)).toEqual([
      "$463.00",
    ])
  })
})

describe("step items", () => {
  // `price` on a dynamic item is already the line total (unit × quantity);
  // multiplying it again doubled every multi-unit line in the drawer.
  it("show the line total once, not multiplied by quantity again", () => {
    cart.dynamicItems = {
      parking: [
        {
          productId: "park",
          stepType: "parking",
          quantity: 2,
          price: 100,
          product: { id: "park", name: "Parking" },
        },
      ],
    }
    summary = { ...summary, itemCount: 2, discountPercent: 30 }
    render(<CartItemList />)

    expect(screen.getByText("$70.00")).toBeTruthy()
    expect(screen.getByText("$100.00").className).toContain("line-through")
    expect(screen.queryByText("$200.00")).toBeNull()
  })
})
