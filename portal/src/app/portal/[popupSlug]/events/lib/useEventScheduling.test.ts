import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  combineDateTimeInTz,
  formatDateKeyInTz,
  formatHhmmInTz,
  todayInTz,
  useEventScheduling,
} from "./useEventScheduling"

// TZ-correctness tests for the portal event form's scheduling primitives.
// All conversions happen via Intl with an explicit `timeZone` argument, so
// these assertions don't depend on the host's local TZ.

describe("combineDateTimeInTz", () => {
  it("interprets HH:mm in the given tz and returns the matching UTC ms", () => {
    const ms = combineDateTimeInTz("2026-06-04", "13:00", "America/Los_Angeles")
    expect(ms).toBe(Date.UTC(2026, 5, 4, 20, 0)) // 13:00 LA in DST = 20:00Z
  })

  it("Tokyo gives a different UTC instant for the same wall-clock time", () => {
    const ms = combineDateTimeInTz("2026-06-04", "13:00", "Asia/Tokyo")
    expect(ms).toBe(Date.UTC(2026, 5, 4, 4, 0)) // 13:00 Tokyo (UTC+9) = 04:00Z
  })

  it("UTC tz: HH:mm is the literal UTC clock", () => {
    expect(combineDateTimeInTz("2026-06-04", "13:00", "UTC")).toBe(
      Date.UTC(2026, 5, 4, 13, 0),
    )
  })

  it("returns NaN for empty inputs", () => {
    expect(combineDateTimeInTz("", "13:00", "UTC")).toBeNaN()
    expect(combineDateTimeInTz("2026-06-04", "", "UTC")).toBeNaN()
  })

  it("returns NaN for malformed inputs", () => {
    expect(combineDateTimeInTz("not-a-date", "13:00", "UTC")).toBeNaN()
    expect(combineDateTimeInTz("2026-06-04", "xx:yy", "UTC")).toBeNaN()
  })
})

describe("todayInTz", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayInTz("UTC")).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("differs from UTC by at most one day in LA", () => {
    const utcKey = todayInTz("UTC")
    const laKey = todayInTz("America/Los_Angeles")
    const [u, l] = [utcKey, laKey].map((k) =>
      new Date(`${k}T00:00:00Z`).getTime(),
    )
    expect(Math.abs(u - l)).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
  })
})

describe("formatHhmmInTz", () => {
  it("'2026-06-04T20:00Z' in LA → '13:00' (DST UTC-7)", () => {
    expect(
      formatHhmmInTz(new Date("2026-06-04T20:00:00Z"), "America/Los_Angeles"),
    ).toBe("13:00")
  })

  it("'2026-06-04T20:00Z' in Tokyo → '05:00' (UTC+9, next-day local)", () => {
    expect(formatHhmmInTz(new Date("2026-06-04T20:00:00Z"), "Asia/Tokyo")).toBe(
      "05:00",
    )
  })
})

describe("formatDateKeyInTz", () => {
  it("event before UTC midnight stays on the previous LA day", () => {
    // 06:00Z 2026-06-04 == 23:00 2026-06-03 in LA (UTC-7).
    expect(
      formatDateKeyInTz(
        new Date("2026-06-04T06:00:00Z"),
        "America/Los_Angeles",
      ),
    ).toBe("2026-06-03")
  })

  it("noon UTC stays on the same UTC day", () => {
    expect(formatDateKeyInTz(new Date("2026-06-04T12:00:00Z"), "UTC")).toBe(
      "2026-06-04",
    )
  })
})

describe("useEventScheduling", () => {
  it("derives startIso from dateStr/timeStr in the configured displayTz", () => {
    const { result } = renderHook(() =>
      useEventScheduling({
        displayTz: "America/Los_Angeles",
        initialDateStr: "2026-06-04",
        initialTimeStr: "13:00",
        initialDurationMinutes: 60,
      }),
    )

    expect(result.current.startIso).toBe("2026-06-04T20:00:00.000Z")
    expect(result.current.endIso).toBe("2026-06-04T21:00:00.000Z")
    expect(result.current.durationMinutes).toBe(60)
    expect(result.current.durationUnit).toBe("hours")
    expect(result.current.durationValue).toBe(1)
  })

  it("setTimeStr updates startIso through the popup tz", () => {
    const { result } = renderHook(() =>
      useEventScheduling({
        displayTz: "America/Los_Angeles",
        initialDateStr: "2026-06-04",
        initialTimeStr: "09:00",
      }),
    )
    act(() => result.current.setTimeStr("13:00"))
    expect(result.current.startIso).toBe("2026-06-04T20:00:00.000Z")
  })

  it("endIso = startIso + durationMinutes (durationUnit=hours)", () => {
    const { result } = renderHook(() =>
      useEventScheduling({
        displayTz: "America/Los_Angeles",
        initialDateStr: "2026-06-04",
        initialTimeStr: "13:00",
        initialDurationMinutes: 180,
      }),
    )
    expect(result.current.startIso).toBe("2026-06-04T20:00:00.000Z")
    // 3h after 13:00 LA = 23:00Z.
    expect(result.current.endIso).toBe("2026-06-04T23:00:00.000Z")
    expect(result.current.durationMinutes).toBe(180)
  })

  it("switching to minutes preserves the same derived duration", () => {
    const { result } = renderHook(() =>
      useEventScheduling({
        displayTz: "America/Los_Angeles",
        initialDateStr: "2026-06-04",
        initialTimeStr: "13:00",
        initialDurationMinutes: 60,
      }),
    )
    // Start in hours (value=1).
    expect(result.current.durationUnit).toBe("hours")
    expect(result.current.durationMinutes).toBe(60)

    // Caller updates value+unit together (form does the conversion).
    act(() => {
      result.current.setDurationUnit("minutes")
      result.current.setDurationValue(60)
    })
    expect(result.current.durationMinutes).toBe(60)
    expect(result.current.endIso).toBe("2026-06-04T21:00:00.000Z")
  })
})
