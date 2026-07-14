import { describe, expect, it } from "vitest"
import { resolveNavVariant } from "./navVariant"

describe("resolveNavVariant", () => {
  it("returns 'pills' when theme_config.checkout_nav_variant is 'pills'", () => {
    expect(resolveNavVariant({ checkout_nav_variant: "pills" })).toBe("pills")
  })

  it("returns 'segmented' when set to 'segmented'", () => {
    expect(resolveNavVariant({ checkout_nav_variant: "segmented" })).toBe(
      "segmented",
    )
  })

  it("defaults to 'segmented' for missing / null / unknown values", () => {
    expect(resolveNavVariant(null)).toBe("segmented")
    expect(resolveNavVariant(undefined)).toBe("segmented")
    expect(resolveNavVariant({})).toBe("segmented")
    expect(resolveNavVariant({ checkout_nav_variant: "fancy" })).toBe(
      "segmented",
    )
  })
})
