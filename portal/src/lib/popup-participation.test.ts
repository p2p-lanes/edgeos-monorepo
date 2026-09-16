import { describe, expect, it } from "vitest"
import { hasAcceptedPopupParticipation } from "./popup-participation"

describe("hasAcceptedPopupParticipation", () => {
  it("accepts any approved application when multiple flows exist", () => {
    expect(
      hasAcceptedPopupParticipation(
        [{ status: "in review" }, { status: "accepted" }],
        null,
      ),
    ).toBe(true)
  })

  it("does not require a selected flow", () => {
    expect(
      hasAcceptedPopupParticipation([{ status: "accepted" }], undefined),
    ).toBe(true)
  })

  it("accepts an approved companion", () => {
    expect(
      hasAcceptedPopupParticipation([], {
        type: "companion",
        application_status: "accepted",
      }),
    ).toBe(true)
  })

  it("rejects pending and rejected participation", () => {
    expect(
      hasAcceptedPopupParticipation(
        [{ status: "in review" }, { status: "rejected" }],
        null,
      ),
    ).toBe(false)
  })
})
