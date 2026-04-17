import { describe, expect, it } from "vitest"
import {
  CHECKOUT_MODE,
  getEffectiveCheckoutMode,
  resolvePopupCheckoutPolicy,
  SALE_TYPE,
} from "@/checkout/popupCheckoutPolicy"

describe("resolvePopupCheckoutPolicy", () => {
  it("falls back to simple_quantity for stale direct-sale contracts", () => {
    expect(
      resolvePopupCheckoutPolicy({
        sale_type: SALE_TYPE.DIRECT,
      }).checkoutMode,
    ).toBe(CHECKOUT_MODE.SIMPLE_QUANTITY)
  })

  it("treats explicit checkout_mode as authoritative", () => {
    const policy = resolvePopupCheckoutPolicy({
      sale_type: SALE_TYPE.DIRECT,
      checkout_mode: CHECKOUT_MODE.PASS_SYSTEM,
    })

    expect(policy.checkoutMode).toBe(CHECKOUT_MODE.PASS_SYSTEM)
    expect(policy.isPassSystem).toBe(true)
    expect(policy.isSimpleQuantity).toBe(false)
  })
})

describe("getEffectiveCheckoutMode", () => {
  it("returns popupMode for ticket category under pass_system", () => {
    expect(getEffectiveCheckoutMode("ticket", CHECKOUT_MODE.PASS_SYSTEM)).toBe(
      CHECKOUT_MODE.PASS_SYSTEM,
    )
  })

  it("returns popupMode for ticket category under simple_quantity", () => {
    expect(
      getEffectiveCheckoutMode("ticket", CHECKOUT_MODE.SIMPLE_QUANTITY),
    ).toBe(CHECKOUT_MODE.SIMPLE_QUANTITY)
  })

  it("returns simple_quantity for housing regardless of popup mode", () => {
    expect(getEffectiveCheckoutMode("housing", CHECKOUT_MODE.PASS_SYSTEM)).toBe(
      CHECKOUT_MODE.SIMPLE_QUANTITY,
    )
  })

  it("returns simple_quantity for supporter regardless of popup mode", () => {
    expect(
      getEffectiveCheckoutMode("supporter", CHECKOUT_MODE.PASS_SYSTEM),
    ).toBe(CHECKOUT_MODE.SIMPLE_QUANTITY)
  })

  it("returns simple_quantity for merch regardless of popup mode", () => {
    expect(getEffectiveCheckoutMode("merch", CHECKOUT_MODE.PASS_SYSTEM)).toBe(
      CHECKOUT_MODE.SIMPLE_QUANTITY,
    )
  })

  it("returns simple_quantity for other regardless of popup mode", () => {
    expect(getEffectiveCheckoutMode("other", CHECKOUT_MODE.PASS_SYSTEM)).toBe(
      CHECKOUT_MODE.SIMPLE_QUANTITY,
    )
  })

  it("returns simple_quantity for undefined category", () => {
    expect(getEffectiveCheckoutMode(undefined, CHECKOUT_MODE.PASS_SYSTEM)).toBe(
      CHECKOUT_MODE.SIMPLE_QUANTITY,
    )
  })

  it("returns simple_quantity for null category", () => {
    expect(getEffectiveCheckoutMode(null, CHECKOUT_MODE.PASS_SYSTEM)).toBe(
      CHECKOUT_MODE.SIMPLE_QUANTITY,
    )
  })
})
