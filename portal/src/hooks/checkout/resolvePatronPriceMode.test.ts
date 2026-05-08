/**
 * Unit tests for resolvePatronPriceMode helper.
 *
 * RED phase: tests fail until the helper is created.
 *
 * Requirement: REQ: patron-variable-price-decoupling (design §5 ADR-4)
 */
import { describe, expect, it } from "vitest"
import { resolvePatronPriceMode } from "./resolvePatronPriceMode"

describe("resolvePatronPriceMode", () => {
  it("returns 'variable' when templateConfig is null", () => {
    expect(resolvePatronPriceMode(null)).toBe("variable")
  })

  it("returns 'variable' when templateConfig is undefined", () => {
    expect(resolvePatronPriceMode(undefined)).toBe("variable")
  })

  it("returns 'variable' when templateConfig has no price_mode", () => {
    expect(resolvePatronPriceMode({ presets: [10, 20] })).toBe("variable")
  })

  it("returns 'fixed' when templateConfig.price_mode is 'fixed'", () => {
    expect(resolvePatronPriceMode({ price_mode: "fixed" })).toBe("fixed")
  })

  it("returns 'variable' when templateConfig.price_mode is 'variable'", () => {
    expect(resolvePatronPriceMode({ price_mode: "variable" })).toBe("variable")
  })

  it("returns 'variable' for unknown price_mode values (legacy compat)", () => {
    expect(resolvePatronPriceMode({ price_mode: "unknown" })).toBe("variable")
  })

  it("returns 'variable' when price_mode is a number (invalid type, backward compat)", () => {
    expect(resolvePatronPriceMode({ price_mode: 42 })).toBe("variable")
  })
})
