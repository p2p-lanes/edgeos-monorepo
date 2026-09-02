import { describe, expect, it } from "vitest"
import {
  CHECKOUT_MODE,
  getEffectiveCheckoutMode,
  resolveFlowCheckoutPolicy,
} from "@/checkout/popupCheckoutPolicy"

describe("resolveFlowCheckoutPolicy", () => {
  it("sells one quantity at a time through a direct door", () => {
    const policy = resolveFlowCheckoutPolicy("direct")

    expect(policy.checkoutMode).toBe(CHECKOUT_MODE.SIMPLE_QUANTITY)
    expect(policy.isSimpleQuantity).toBe(true)
  })

  it("sells the same way through an upsale door", () => {
    expect(resolveFlowCheckoutPolicy("upsale").checkoutMode).toBe(
      CHECKOUT_MODE.SIMPLE_QUANTITY,
    )
  })

  it("sells passes per attendee through an application door", () => {
    const policy = resolveFlowCheckoutPolicy("application")

    expect(policy.checkoutMode).toBe(CHECKOUT_MODE.PASS_SYSTEM)
    expect(policy.isPassSystem).toBe(true)
  })

  it("falls back to passes when no door is in scope yet", () => {
    // What the portal has always started from, and what it shows while the
    // door is still being resolved.
    expect(resolveFlowCheckoutPolicy(null).checkoutMode).toBe(
      CHECKOUT_MODE.PASS_SYSTEM,
    )
    expect(resolveFlowCheckoutPolicy(undefined).checkoutMode).toBe(
      CHECKOUT_MODE.PASS_SYSTEM,
    )
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
