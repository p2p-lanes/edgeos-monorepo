import { describe, expect, it } from "vitest"
import {
  clearHousing,
  computeNights,
  emptySelection,
  hasAnySelection,
  selectHousing,
  setCoupon,
  setHousingQuantity,
  setInsurance,
  setQuantity,
  toggleProduct,
  totalSelectedQuantity,
} from "./state"

describe("emptySelection", () => {
  it("starts empty", () => {
    expect(emptySelection()).toEqual({
      quantities: {},
      housing: null,
      insurance: false,
      couponCode: null,
    })
  })
})

describe("computeNights", () => {
  it("counts calendar nights, floored at 1", () => {
    expect(computeNights("2026-08-01", "2026-08-04")).toBe(3)
    expect(computeNights("2026-08-01", "2026-08-02")).toBe(1)
    expect(computeNights("2026-08-01", "2026-08-01")).toBe(1)
    expect(computeNights("2026-08-04", "2026-08-01")).toBe(1)
  })
})

describe("setQuantity / toggleProduct", () => {
  it("sets a positive quantity and removes on <= 0", () => {
    let s = setQuantity(emptySelection(), "p1", 3)
    expect(s.quantities).toEqual({ p1: 3 })
    s = setQuantity(s, "p1", 0)
    expect(s.quantities).toEqual({})
  })

  it("does not mutate the input state", () => {
    const s0 = emptySelection()
    const s1 = setQuantity(s0, "p1", 1)
    expect(s0.quantities).toEqual({})
    expect(s1).not.toBe(s0)
  })

  it("toggles presence 0 <-> 1", () => {
    let s = toggleProduct(emptySelection(), "p1")
    expect(s.quantities).toEqual({ p1: 1 })
    s = toggleProduct(s, "p1")
    expect(s.quantities).toEqual({})
  })
})

describe("housing", () => {
  it("selects housing and derives nights, default qty 1, per-night default", () => {
    const s = selectHousing(emptySelection(), {
      productId: "h1",
      checkIn: "2026-08-01",
      checkOut: "2026-08-05",
    })
    expect(s.housing).toEqual({
      productId: "h1",
      checkIn: "2026-08-01",
      checkOut: "2026-08-05",
      nights: 4,
      quantity: 1,
      pricePerNight: true,
    })
  })

  it("preserves quantity when re-selecting the same product (date change)", () => {
    let s = selectHousing(emptySelection(), {
      productId: "h1",
      checkIn: "2026-08-01",
      checkOut: "2026-08-05",
      quantity: 2,
    })
    s = selectHousing(s, {
      productId: "h1",
      checkIn: "2026-08-02",
      checkOut: "2026-08-05",
    })
    expect(s.housing?.quantity).toBe(2)
    expect(s.housing?.nights).toBe(3)
  })

  it("resets quantity to 1 when switching to a different housing product", () => {
    let s = selectHousing(emptySelection(), {
      productId: "h1",
      checkIn: "2026-08-01",
      checkOut: "2026-08-05",
      quantity: 3,
    })
    s = selectHousing(s, {
      productId: "h2",
      checkIn: "2026-08-01",
      checkOut: "2026-08-05",
    })
    expect(s.housing?.productId).toBe("h2")
    expect(s.housing?.quantity).toBe(1)
  })

  it("setHousingQuantity clears housing on <= 0", () => {
    let s = selectHousing(emptySelection(), {
      productId: "h1",
      checkIn: "2026-08-01",
      checkOut: "2026-08-05",
    })
    s = setHousingQuantity(s, 4)
    expect(s.housing?.quantity).toBe(4)
    s = setHousingQuantity(s, 0)
    expect(s.housing).toBeNull()
  })

  it("clearHousing removes the selection", () => {
    const s = selectHousing(emptySelection(), {
      productId: "h1",
      checkIn: "2026-08-01",
      checkOut: "2026-08-05",
    })
    expect(clearHousing(s).housing).toBeNull()
  })
})

describe("insurance / coupon", () => {
  it("sets insurance and coupon", () => {
    let s = setInsurance(emptySelection(), true)
    expect(s.insurance).toBe(true)
    s = setCoupon(s, "SAVE10")
    expect(s.couponCode).toBe("SAVE10")
    s = setCoupon(s, null)
    expect(s.couponCode).toBeNull()
  })
})

describe("counts", () => {
  it("totalSelectedQuantity sums products + housing units", () => {
    let s = setQuantity(emptySelection(), "p1", 2)
    s = setQuantity(s, "p2", 1)
    s = selectHousing(s, {
      productId: "h1",
      checkIn: "2026-08-01",
      checkOut: "2026-08-03",
      quantity: 2,
    })
    expect(totalSelectedQuantity(s)).toBe(5)
  })

  it("hasAnySelection reflects any product or housing", () => {
    expect(hasAnySelection(emptySelection())).toBe(false)
    expect(hasAnySelection(setQuantity(emptySelection(), "p1", 1))).toBe(true)
  })
})
