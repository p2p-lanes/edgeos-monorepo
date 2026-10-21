import { afterEach, describe, expect, it } from "vitest"
import { formatCurrency, formatPrice, setActiveCurrency } from "./checkout"

afterEach(() => {
  setActiveCurrency("USD")
})

describe("formatCurrency", () => {
  // Trailing zeros used to be dropped, so a discounted $324.1 sat next to a
  // whole $463 and the column read as two different precisions.
  it("always shows two decimals", () => {
    expect(formatCurrency(324.1)).toBe("$324.10")
    expect(formatCurrency(1166.2)).toBe("$1,166.20")
    expect(formatCurrency(463)).toBe("$463.00")
    expect(formatCurrency(0)).toBe("$0.00")
  })

  it("rounds to cents", () => {
    expect(formatCurrency(99.999)).toBe("$100.00")
  })

  it("keeps two decimals in other currencies' locales", () => {
    expect(formatCurrency(324.1, "EUR")).toMatch(/324,10/)
  })
})

describe("formatPrice", () => {
  it("uses the free label for zero and two decimals otherwise", () => {
    expect(formatPrice(0, "Free")).toBe("Free")
    expect(formatPrice(5.5, "Free")).toBe("$5.50")
  })
})
