import { describe, expect, it } from "vitest"
import {
  getProductAvailability,
  isProductSoldOut,
} from "./product-availability"

const baseProduct = {
  sale_starts_at: null,
  sale_ends_at: null,
  total_stock_cap: null,
  total_stock_remaining: null,
  max_per_order: null,
}

describe("getProductAvailability", () => {
  it("returns on_sale with unlimited quantity when no caps are set", () => {
    const av = getProductAvailability(baseProduct)
    expect(av.state).toBe("on_sale")
    expect(av.canSelect).toBe(true)
    expect(av.maxAllowedQuantity).toBe(Number.POSITIVE_INFINITY)
  })

  it("flags sold_out and zeroes the max when remaining is 0 against a non-null cap", () => {
    const av = getProductAvailability({
      ...baseProduct,
      total_stock_cap: 1,
      total_stock_remaining: 0,
    })
    expect(av.state).toBe("sold_out")
    expect(av.canSelect).toBe(false)
    expect(av.maxAllowedQuantity).toBe(0)
  })

  it("blocks selection when the sale window has ended even if stock is available", () => {
    const av = getProductAvailability(
      {
        ...baseProduct,
        sale_ends_at: "2026-01-01",
        total_stock_cap: 10,
        total_stock_remaining: 10,
      },
      new Date("2026-02-01"),
    )
    expect(av.state).toBe("ended")
    expect(av.canSelect).toBe(false)
    expect(av.maxAllowedQuantity).toBe(0)
  })

  it("blocks selection for upcoming products", () => {
    const av = getProductAvailability(
      {
        ...baseProduct,
        sale_starts_at: "2027-01-01",
      },
      new Date("2026-01-01"),
    )
    expect(av.state).toBe("upcoming")
    expect(av.canSelect).toBe(false)
  })

  it("respects max_per_order when on sale", () => {
    const av = getProductAvailability({
      ...baseProduct,
      max_per_order: 3,
      total_stock_cap: 100,
      total_stock_remaining: 100,
    })
    expect(av.state).toBe("on_sale")
    expect(av.maxAllowedQuantity).toBe(3)
  })

  it("uses min(max_per_order, remaining) when both are set", () => {
    const av = getProductAvailability({
      ...baseProduct,
      max_per_order: 10,
      total_stock_cap: 5,
      total_stock_remaining: 2,
    })
    expect(av.maxAllowedQuantity).toBe(2)
  })
})

describe("isProductSoldOut", () => {
  it("returns true only when the derived state is sold_out", () => {
    expect(
      isProductSoldOut({
        ...baseProduct,
        total_stock_cap: 1,
        total_stock_remaining: 0,
      }),
    ).toBe(true)
    expect(isProductSoldOut(baseProduct)).toBe(false)
    expect(
      isProductSoldOut({
        ...baseProduct,
        sale_ends_at: "2026-01-01",
      }),
    ).toBe(false)
  })
})
