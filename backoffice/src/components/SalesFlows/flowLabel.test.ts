import { describe, expect, it } from "vitest"

import { formatSalesFlowLabel } from "./flowLabel"

describe("formatSalesFlowLabel", () => {
  it("marks the primary sales flow without exposing retired default terminology", () => {
    expect(formatSalesFlowLabel({ name: "Attendee", is_default: true })).toBe(
      "Attendee (primary)",
    )
    expect(formatSalesFlowLabel({ name: "Checkout", is_default: true })).toBe(
      "Checkout (primary)",
    )
  })

  it("keeps a non-primary sales flow name unchanged", () => {
    expect(
      formatSalesFlowLabel({ name: "Volunteers", is_default: false }),
    ).toBe("Volunteers")
  })
})
