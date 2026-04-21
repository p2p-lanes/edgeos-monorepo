import { describe, expect, it } from "vitest"
import {
  getPassSelectionLayout,
  shouldDisableForPrimaryRestriction,
} from "@/checkout/passSelectionUi"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"

describe("passSelectionUi", () => {
  it("uses a flat quantity-first layout in simple_quantity", () => {
    expect(getPassSelectionLayout(CHECKOUT_MODE.SIMPLE_QUANTITY)).toBe("flat")
    expect(getPassSelectionLayout(CHECKOUT_MODE.PASS_SYSTEM)).toBe("grouped")
  })

  it("bypasses spouse/child primary restrictions in simple_quantity", () => {
    expect(
      shouldDisableForPrimaryRestriction({
        checkoutMode: CHECKOUT_MODE.SIMPLE_QUANTITY,
        attendeeCategory: "spouse",
        primaryHasPass: false,
      }),
    ).toBe(false)

    expect(
      shouldDisableForPrimaryRestriction({
        checkoutMode: CHECKOUT_MODE.PASS_SYSTEM,
        attendeeCategory: "spouse",
        primaryHasPass: false,
      }),
    ).toBe(true)
  })
})
