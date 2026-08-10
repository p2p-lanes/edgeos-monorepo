/**
 * The guard used to take a `needsFlowChoice` tri-state as well, because
 * the application it was asked about was resolved by human and gathering
 * and might belong to another way in — so a terminal status could send
 * someone away from a door they had not applied through yet.
 *
 * The caller resolves the application per door now
 * (sdd/sales-flows-rediseno). It belongs here or it is null, and a
 * terminal status needs nothing else to qualify it.
 */
import { describe, expect, it } from "vitest"
import { shouldRedirectToStatus } from "./shouldRedirectToStatus"

describe("shouldRedirectToStatus", () => {
  it("redirects on a resolved application", () => {
    expect(shouldRedirectToStatus("accepted")).toBe(true)
    expect(shouldRedirectToStatus("rejected")).toBe(true)
  })

  it("keeps the form open while the application can still be finished", () => {
    expect(shouldRedirectToStatus("draft")).toBe(false)
    expect(shouldRedirectToStatus("in review")).toBe(false)
  })

  it("never redirects on no application at all", () => {
    /* No application for this door is the case for someone applying
       through it for the first time. */
    expect(shouldRedirectToStatus(undefined)).toBe(false)
    expect(shouldRedirectToStatus(null)).toBe(false)
  })
})
