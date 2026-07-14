import { describe, expect, it } from "vitest"
import { computeThemeVars } from "./themeExpand"

describe("themeExpand computeThemeVars — checkout chrome (portal mirror)", () => {
  it("emits the 180deg gradient image when checkout_navbar_bg_to is set", () => {
    const vars = computeThemeVars({ checkout_navbar_bg_to: "rgba(1,15,22,0)" })
    expect(vars["--checkout-navbar-bg-to"]).toBe("rgba(1,15,22,0)")
    expect(vars["--checkout-navbar-image"]).toBe(
      "linear-gradient(180deg, var(--checkout-navbar-bg), var(--checkout-navbar-bg-to))",
    )
  })

  it("emits border / accent / button-border overrides when set", () => {
    const vars = computeThemeVars({
      checkout_navbar_border: "rgba(255,255,255,0.2)",
      checkout_badge_border: "rgba(193,170,136,0.7)",
      checkout_bottom_bar_border: "rgba(255,255,255,0.08)",
      checkout_bottom_bar_accent_color: "#c1aa88",
      checkout_button_border: "#c1aa88",
    })
    expect(vars["--checkout-navbar-border"]).toBe("rgba(255,255,255,0.2)")
    expect(vars["--checkout-badge-border"]).toBe("rgba(193,170,136,0.7)")
    expect(vars["--checkout-bottom-bar-border"]).toBe("rgba(255,255,255,0.08)")
    expect(vars["--checkout-bottom-bar-accent"]).toBe("#c1aa88")
    expect(vars["--checkout-button-border"]).toBe("#c1aa88")
  })

  it("emits nothing chrome-related for empty colors", () => {
    const vars = computeThemeVars({})
    expect(vars["--checkout-navbar-image"]).toBeUndefined()
    expect(vars["--checkout-button-border"]).toBeUndefined()
  })
})
