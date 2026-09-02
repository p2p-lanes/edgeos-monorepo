import { afterEach, describe, expect, it, vi } from "vitest"
import { trackPortalTelemetry } from "./portal-telemetry"

describe("trackPortalTelemetry", () => {
  afterEach(() => {
    delete (window as Window & { gtag?: unknown }).gtag
  })

  it("emits allowlisted portal events without identifiers or purchase data", () => {
    const gtag = vi.fn()
    ;(window as Window & { gtag?: unknown }).gtag = gtag

    trackPortalTelemetry("checkout_failed")

    expect(gtag).toHaveBeenCalledWith("event", "checkout_failed", {
      surface: "portal",
    })
  })

  it("does not emit when analytics is unavailable", () => {
    expect(() => trackPortalTelemetry("access_code_opened")).not.toThrow()
  })
})
