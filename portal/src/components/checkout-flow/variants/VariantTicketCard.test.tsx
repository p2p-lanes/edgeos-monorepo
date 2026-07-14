import { describe, expect, it } from "vitest"
import { parseVariant } from "./VariantTicketCard"

describe("parseVariant", () => {
  it("returns showcase when configured", () => {
    expect(parseVariant({ variant: "showcase" })).toBe("showcase")
  })

  it("passes through tabs and compact", () => {
    expect(parseVariant({ variant: "tabs" })).toBe("tabs")
    expect(parseVariant({ variant: "compact" })).toBe("compact")
  })

  it("falls back to stacked for unknown or missing", () => {
    expect(parseVariant({ variant: "bogus" })).toBe("stacked")
    expect(parseVariant({})).toBe("stacked")
    expect(parseVariant(null)).toBe("stacked")
    expect(parseVariant(undefined)).toBe("stacked")
  })
})
