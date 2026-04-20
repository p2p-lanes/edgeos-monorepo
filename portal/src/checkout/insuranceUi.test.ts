import { describe, expect, it } from "vitest"
import {
  buildCheckoutInsuranceSummary,
  getCheckoutInsuranceAmount,
  isCheckoutInsuranceAvailable,
} from "@/checkout/insuranceUi"
import type {
  SelectedHousingItem,
  SelectedMerchItem,
  SelectedPassItem,
} from "@/types/checkout"

// ---------------------------------------------------------------------------
// Minimal stubs for cart items
// ---------------------------------------------------------------------------

function makePass(
  id: string,
  price: number,
  insuranceEligible: boolean,
): SelectedPassItem {
  return {
    productId: id,
    product: {
      id,
      name: `Pass ${id}`,
      insurance_eligible: insuranceEligible,
    } as SelectedPassItem["product"],
    attendeeId: `attendee-${id}`,
    attendee: {} as SelectedPassItem["attendee"],
    quantity: 1,
    price,
  }
}

function makeMerch(
  id: string,
  totalPrice: number,
  insuranceEligible: boolean,
): SelectedMerchItem {
  return {
    productId: id,
    product: {
      id,
      name: `Merch ${id}`,
      insurance_eligible: insuranceEligible,
    } as SelectedMerchItem["product"],
    quantity: 1,
    unitPrice: totalPrice,
    totalPrice,
  }
}

const emptyCart = { passes: [], housing: null, merch: [] }

// ---------------------------------------------------------------------------
// isCheckoutInsuranceAvailable
// ---------------------------------------------------------------------------

describe("isCheckoutInsuranceAvailable", () => {
  it("returns true when enabled with a valid positive percentage", () => {
    expect(
      isCheckoutInsuranceAvailable({
        insurance_enabled: true,
        insurance_percentage: "5.00",
      }),
    ).toBe(true)
  })

  it("returns false when insurance_enabled is false", () => {
    expect(
      isCheckoutInsuranceAvailable({
        insurance_enabled: false,
        insurance_percentage: "5.00",
      }),
    ).toBe(false)
  })

  it("returns false when insurance_percentage is null (data inconsistency guard)", () => {
    expect(
      isCheckoutInsuranceAvailable({
        insurance_enabled: true,
        insurance_percentage: null,
      }),
    ).toBe(false)
  })

  it("returns false when popup is null", () => {
    expect(isCheckoutInsuranceAvailable(null)).toBe(false)
  })

  it("returns false when popup is undefined", () => {
    expect(isCheckoutInsuranceAvailable(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getCheckoutInsuranceAmount
// ---------------------------------------------------------------------------

describe("getCheckoutInsuranceAmount", () => {
  it("returns percentage × subtotal when available", () => {
    const popup = { insurance_enabled: true, insurance_percentage: "5.00" }
    expect(getCheckoutInsuranceAmount(popup, 100)).toBe(5)
  })

  it("returns 0 when insurance is not available (disabled)", () => {
    const popup = { insurance_enabled: false, insurance_percentage: "5.00" }
    expect(getCheckoutInsuranceAmount(popup, 100)).toBe(0)
  })

  it("returns 0 when insurance_percentage is null", () => {
    const popup = { insurance_enabled: true, insurance_percentage: null }
    expect(getCheckoutInsuranceAmount(popup, 100)).toBe(0)
  })

  it("returns 0 when eligible subtotal is 0", () => {
    const popup = { insurance_enabled: true, insurance_percentage: "5.00" }
    expect(getCheckoutInsuranceAmount(popup, 0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// buildCheckoutInsuranceSummary — POPUP-7
// ---------------------------------------------------------------------------

describe("buildCheckoutInsuranceSummary", () => {
  it("returns correct summary with 2 eligible passes and 1 non-eligible", () => {
    const popup = { insurance_enabled: true, insurance_percentage: "5.00" }
    const passes = [
      makePass("p1", 100, true),
      makePass("p2", 200, true),
      makePass("p3", 50, false),
    ]

    const summary = buildCheckoutInsuranceSummary(popup, {
      passes,
      housing: null,
      merch: [],
    })

    expect(summary.enabled).toBe(true)
    expect(summary.percentage).toBe(5)
    // 5% × (100 + 200) = 15
    expect(summary.amount).toBe(15)
    expect(summary.eligibleProductIds).toEqual(["p1", "p2"])
    expect(summary.eligibleProductIds).not.toContain("p3")
  })

  it("returns enabled:false, amount:0, eligibleProductIds:[] when insurance_enabled is false", () => {
    const popup = { insurance_enabled: false, insurance_percentage: "5.00" }
    const passes = [makePass("p1", 100, true)]

    const summary = buildCheckoutInsuranceSummary(popup, {
      passes,
      housing: null,
      merch: [],
    })

    expect(summary.enabled).toBe(false)
    expect(summary.amount).toBe(0)
    expect(summary.eligibleProductIds).toEqual([])
    expect(summary.percentage).toBeNull()
  })

  it("returns enabled:false, amount:0 when insurance_percentage is null", () => {
    const popup = { insurance_enabled: true, insurance_percentage: null }
    const passes = [makePass("p1", 100, true)]

    const summary = buildCheckoutInsuranceSummary(popup, {
      passes,
      housing: null,
      merch: [],
    })

    expect(summary.enabled).toBe(false)
    expect(summary.amount).toBe(0)
    expect(summary.eligibleProductIds).toEqual([])
  })

  it("returns amount:0 and empty eligibleProductIds when no products are eligible", () => {
    const popup = { insurance_enabled: true, insurance_percentage: "5.00" }
    const passes = [makePass("p1", 100, false), makePass("p2", 200, false)]

    const summary = buildCheckoutInsuranceSummary(popup, {
      passes,
      housing: null,
      merch: [],
    })

    expect(summary.enabled).toBe(true)
    expect(summary.amount).toBe(0)
    expect(summary.eligibleProductIds).toEqual([])
  })

  it("includes eligible merch in subtotal", () => {
    const popup = { insurance_enabled: true, insurance_percentage: "10.00" }
    const merch = [makeMerch("m1", 50, true), makeMerch("m2", 30, false)]

    const summary = buildCheckoutInsuranceSummary(popup, {
      passes: [],
      housing: null,
      merch,
    })

    // 10% × 50 = 5
    expect(summary.amount).toBe(5)
    expect(summary.eligibleProductIds).toEqual(["m1"])
  })

  it("includes eligible housing in subtotal", () => {
    const popup = { insurance_enabled: true, insurance_percentage: "10.00" }
    const housing: SelectedHousingItem = {
      productId: "h1",
      product: {
        id: "h1",
        name: "Housing",
        insurance_eligible: true,
      } as SelectedHousingItem["product"],
      checkIn: "2025-01-01",
      checkOut: "2025-01-03",
      nights: 2,
      pricePerNight: 100,
      totalPrice: 200,
      pricePerDay: false,
      quantity: 1,
    }

    const summary = buildCheckoutInsuranceSummary(popup, {
      passes: [],
      housing,
      merch: [],
    })

    // 10% × 200 = 20
    expect(summary.amount).toBe(20)
    expect(summary.eligibleProductIds).toContain("h1")
  })

  it("returns empty summary for null popup", () => {
    const summary = buildCheckoutInsuranceSummary(null, emptyCart)

    expect(summary.enabled).toBe(false)
    expect(summary.amount).toBe(0)
    expect(summary.percentage).toBeNull()
    expect(summary.eligibleProductIds).toEqual([])
  })
})
