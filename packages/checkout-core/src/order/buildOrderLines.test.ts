import { describe, expect, it } from "vitest"
import {
  emptySelection,
  selectHousing,
  setQuantity,
} from "../selection/state"
import { buildOrderLines, housingLineQuantity } from "./buildOrderLines"

describe("housingLineQuantity", () => {
  it("multiplies nights by units when priced per night", () => {
    expect(
      housingLineQuantity({ nights: 4, quantity: 2, pricePerNight: true }),
    ).toBe(8)
  })

  it("uses units only when not priced per night", () => {
    expect(
      housingLineQuantity({ nights: 4, quantity: 2, pricePerNight: false }),
    ).toBe(2)
  })
})

describe("buildOrderLines", () => {
  it("emits a line per selected product", () => {
    let s = setQuantity(emptySelection(), "p1", 2)
    s = setQuantity(s, "p2", 1)
    expect(buildOrderLines(s)).toEqual([
      { product_id: "p1", quantity: 2 },
      { product_id: "p2", quantity: 1 },
    ])
  })

  it("returns [] for an empty selection", () => {
    expect(buildOrderLines(emptySelection())).toEqual([])
  })

  it("folds housing nights into the line quantity", () => {
    const s = selectHousing(emptySelection(), {
      productId: "h1",
      checkIn: "2026-08-01",
      checkOut: "2026-08-05", // 4 nights
      quantity: 2,
    })
    expect(buildOrderLines(s)).toEqual([{ product_id: "h1", quantity: 8 }])
  })

  it("aggregates housing sharing a product id with a standard selection", () => {
    let s = setQuantity(emptySelection(), "h1", 1)
    s = selectHousing(s, {
      productId: "h1",
      checkIn: "2026-08-01",
      checkOut: "2026-08-03", // 2 nights
      quantity: 1,
    })
    // 1 (standard) + 2 (housing nights) = 3
    expect(buildOrderLines(s)).toEqual([{ product_id: "h1", quantity: 3 }])
  })
})
