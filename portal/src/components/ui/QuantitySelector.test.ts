import { describe, expect, it } from "vitest"
import { resolveBlockedStepperProps } from "./QuantitySelector"

describe("resolveBlockedStepperProps", () => {
  it("keeps a blocked row with cart quantity enabled, capping max at the quantity", () => {
    // Increment self-disables at max while decrement keeps working, so the
    // user can still remove a product that went sold out mid-session.
    expect(
      resolveBlockedStepperProps({ blocked: true, quantity: 2, max: 10 }),
    ).toEqual({ max: 2, disabled: false })
  })

  it("fully disables a blocked row with nothing in the cart", () => {
    expect(
      resolveBlockedStepperProps({ blocked: true, quantity: 0, max: 10 }),
    ).toEqual({ max: 10, disabled: true })
  })

  it("freezes locked rows even when quantity is in the cart", () => {
    // Purchased-locked rows must never be editable, blocked or not.
    expect(
      resolveBlockedStepperProps({
        blocked: true,
        locked: true,
        quantity: 2,
        max: 10,
      }),
    ).toEqual({ max: 10, disabled: true })
    expect(
      resolveBlockedStepperProps({
        blocked: false,
        locked: true,
        quantity: 2,
        max: 10,
      }),
    ).toEqual({ max: 10, disabled: true })
  })

  it("passes through untouched props for rows on sale", () => {
    expect(
      resolveBlockedStepperProps({ blocked: false, quantity: 3, max: 10 }),
    ).toEqual({ max: 10, disabled: false })
  })
})
