import { describe, expect, it } from "vitest"

import { resolveApplicationFlowId } from "./resolveApplicationFlowId"

const flows = [
  { id: "attendee-flow-id", slug: "attendee" },
  { id: "volunteer-flow-id", slug: "volunteers" },
]

describe("resolveApplicationFlowId", () => {
  it("resolves an application URL's flow slug to its internal flow id", () => {
    expect(resolveApplicationFlowId("attendee", flows)).toBe("attendee-flow-id")
  })

  it("accepts an internal flow id from an authenticated portal handoff", () => {
    expect(resolveApplicationFlowId("volunteer-flow-id", flows)).toBe(
      "volunteer-flow-id",
    )
  })
})
