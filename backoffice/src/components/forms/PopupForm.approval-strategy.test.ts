import { describe, expect, it } from "vitest"
import { applicationReviewVisibility } from "./popupApplicationReviewVisibility"

describe("PopupForm application review visibility", () => {
  it("shows the gathering strategy for a direct-only gathering", () => {
    expect(
      applicationReviewVisibility({ isEdit: true, takesApplications: false }),
    ).toEqual({ strategy: true, reviewers: false })
  })

  it("shows strategy and reviewers when an application flow exists", () => {
    expect(
      applicationReviewVisibility({ isEdit: true, takesApplications: true }),
    ).toEqual({ strategy: true, reviewers: true })
  })
})
