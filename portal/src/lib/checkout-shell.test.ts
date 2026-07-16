import { describe, expect, it } from "vitest"
import type { PopupPublic } from "@/client"
import { resolveCheckoutShell } from "./checkout-shell"

function popupWith(themeConfig: unknown): PopupPublic {
  return { theme_config: themeConfig } as unknown as PopupPublic
}

describe("resolveCheckoutShell", () => {
  it('returns "stepper" when theme_config.checkout_shell is "stepper"', () => {
    expect(resolveCheckoutShell(popupWith({ checkout_shell: "stepper" }))).toBe(
      "stepper",
    )
  })

  it('defaults to "scrolly" when unset', () => {
    expect(resolveCheckoutShell(popupWith({}))).toBe("scrolly")
    expect(resolveCheckoutShell(popupWith(null))).toBe("scrolly")
    expect(resolveCheckoutShell(null)).toBe("scrolly")
    expect(resolveCheckoutShell(undefined)).toBe("scrolly")
  })

  it('falls back to "scrolly" on an unknown value', () => {
    expect(resolveCheckoutShell(popupWith({ checkout_shell: "bogus" }))).toBe(
      "scrolly",
    )
  })
})
