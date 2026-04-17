import { describe, expect, it } from "vitest"
import {
  CHECKOUT_MODE,
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
