import { describe, expect, it } from "vitest"
import { shouldRedirectToStatus } from "./shouldRedirectToStatus"

describe("shouldRedirectToStatus", () => {
  it("redirects when needsFlowChoice is false and the application is terminal", () => {
    expect(shouldRedirectToStatus(false, "accepted")).toBe(true)
    expect(shouldRedirectToStatus(false, "rejected")).toBe(true)
  })

  it("does not redirect when needsFlowChoice is true, even if terminal — lets FlowPicker mount", () => {
    expect(shouldRedirectToStatus(true, "accepted")).toBe(false)
    expect(shouldRedirectToStatus(true, "rejected")).toBe(false)
  })

  it("does not redirect when needsFlowChoice is null (not yet resolved) — renders without redirecting", () => {
    expect(shouldRedirectToStatus(null, "accepted")).toBe(false)
    expect(shouldRedirectToStatus(null, "rejected")).toBe(false)
  })

  it("does not redirect for non-terminal statuses regardless of needsFlowChoice", () => {
    expect(shouldRedirectToStatus(false, "draft")).toBe(false)
    expect(shouldRedirectToStatus(false, "in review")).toBe(false)
    expect(shouldRedirectToStatus(false, undefined)).toBe(false)
    expect(shouldRedirectToStatus(false, null)).toBe(false)
  })
})
