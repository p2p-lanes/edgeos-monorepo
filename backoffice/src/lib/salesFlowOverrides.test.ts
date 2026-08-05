import { describe, expect, it } from "vitest"

import { getOverrideMode, resolveOverrideValue } from "./salesFlowOverrides"

describe("salesFlowOverrides", () => {
  describe("getOverrideMode", () => {
    it("treats null as inherit (D1: NULL means read the popup)", () => {
      expect(getOverrideMode(null)).toBe("inherit")
    })

    it("treats undefined as inherit", () => {
      expect(getOverrideMode(undefined)).toBe("inherit")
    })

    it("treats an explicit false as an override, not inherit", () => {
      // Boolean tri-state: an admin explicitly disabling a flag must not be
      // conflated with "no opinion, read the popup".
      expect(getOverrideMode(false)).toBe("override")
    })

    it("treats an explicit zero as an override, not inherit", () => {
      expect(getOverrideMode(0)).toBe("override")
    })

    it("treats a non-empty string as an override", () => {
      expect(getOverrideMode("multi_step")).toBe("override")
    })
  })

  describe("resolveOverrideValue", () => {
    it("resolves to null when mode is inherit, discarding the draft value", () => {
      expect(resolveOverrideValue("inherit", true)).toBeNull()
    })

    it("resolves to the draft value when mode is override", () => {
      expect(resolveOverrideValue("override", true)).toBe(true)
    })

    it("preserves a falsy override value of zero instead of collapsing to null", () => {
      expect(resolveOverrideValue("override", 0)).toBe(0)
    })

    it("preserves an empty-string override value instead of collapsing to null", () => {
      expect(resolveOverrideValue("override", "")).toBe("")
    })
  })
})
