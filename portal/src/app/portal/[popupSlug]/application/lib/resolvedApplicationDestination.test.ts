import { describe, expect, it } from "vitest"
import { resolvedApplicationDestination } from "./resolvedApplicationDestination"

describe("resolvedApplicationDestination", () => {
  it("sends an acceptance to the passes of the door that accepted them", () => {
    expect(
      resolvedApplicationDestination("tech-summit-2025", {
        status: "accepted",
        sales_flow_id: "flow-volunteers",
      }),
    ).toBe("/portal/tech-summit-2025/passes?flow=flow-volunteers")
  })

  it("keeps a rejection on the gathering home", () => {
    // There are no passes to show, and the door card there is what says
    // what happened.
    expect(
      resolvedApplicationDestination("tech-summit-2025", {
        status: "rejected",
        sales_flow_id: "flow-volunteers",
      }),
    ).toBe("/portal/tech-summit-2025")
  })

  it("keeps an acceptance with no door on the gathering home", () => {
    // Predates the flow re-key, so there is no door to name.
    expect(
      resolvedApplicationDestination("tech-summit-2025", {
        status: "accepted",
        sales_flow_id: null,
      }),
    ).toBe("/portal/tech-summit-2025")
  })
})
