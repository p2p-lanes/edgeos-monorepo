import { describe, expect, it } from "vitest"
import { eventListWindowForPopup } from "./listWindow"

describe("eventListWindowForPopup", () => {
  it("spans the full popup window even while the popup is in progress", () => {
    const window = eventListWindowForPopup(
      "2026-05-30",
      "2026-06-02",
      "America/Los_Angeles",
      new Date("2026-06-01T01:00:00.000Z"),
    )

    // The window is no longer clamped to "today": events from earlier popup
    // days (May 30/31) stay in the list instead of silently dropping out once
    // the local date rolls past them — matching the calendar and day views.
    expect(window.startAfter).toBe("2026-05-30T07:00:00.000Z")
    expect(window.startBefore).toBe("2026-06-03T07:00:00.000Z")
  })

  it("keeps the full popup window before the popup starts", () => {
    const window = eventListWindowForPopup(
      "2026-05-30",
      "2026-06-02",
      "America/Los_Angeles",
      new Date("2026-05-29T18:00:00.000Z"),
    )

    expect(window.startAfter).toBe("2026-05-30T07:00:00.000Z")
    expect(window.startBefore).toBe("2026-06-03T07:00:00.000Z")
  })

  it("keeps the full popup window after the popup ends", () => {
    const window = eventListWindowForPopup(
      "2026-05-30",
      "2026-06-02",
      "America/Los_Angeles",
      new Date("2026-06-04T18:00:00.000Z"),
    )

    expect(window.startAfter).toBe("2026-05-30T07:00:00.000Z")
    expect(window.startBefore).toBe("2026-06-03T07:00:00.000Z")
  })

  it("falls back to a 180-day UTC window without popup dates", () => {
    const window = eventListWindowForPopup(
      null,
      null,
      "America/Los_Angeles",
      new Date("2026-06-01T15:30:00.000Z"),
    )

    expect(window.startAfter).toBe("2026-06-01T00:00:00.000Z")
    expect(window.startBefore).toBe("2026-11-28T00:00:00.000Z")
  })
})
