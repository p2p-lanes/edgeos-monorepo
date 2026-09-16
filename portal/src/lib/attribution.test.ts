import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  captureAttribution,
  getAttribution,
  getFbclidCapture,
} from "./attribution"

describe("marketing attribution", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("keeps the first-seen timestamp for the current fbclid", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1710000000123)

    captureAttribution(
      new URLSearchParams("fbclid=first-click&utm_source=meta"),
    )

    expect(getAttribution()).toEqual({
      fbclid: "first-click",
      utm_source: "meta",
    })
    expect(getFbclidCapture()).toEqual({
      fbclid: "first-click",
      capturedAt: 1710000000123,
    })

    now.mockReturnValue(1720000000456)
    captureAttribution(new URLSearchParams("fbclid=first-click"))

    expect(getFbclidCapture()).toEqual({
      fbclid: "first-click",
      capturedAt: 1710000000123,
    })
  })

  it("refreshes the timestamp when a new fbclid is captured", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1710000000123)
    captureAttribution(new URLSearchParams("fbclid=first-click"))

    now.mockReturnValue(1720000000456)
    captureAttribution(new URLSearchParams("fbclid=second-click"))

    expect(getAttribution().fbclid).toBe("second-click")
    expect(getFbclidCapture()).toEqual({
      fbclid: "second-click",
      capturedAt: 1720000000456,
    })
  })

  it("does not create click metadata without fbclid", () => {
    captureAttribution(new URLSearchParams("utm_source=newsletter"))

    expect(getFbclidCapture()).toBeUndefined()
  })
})
