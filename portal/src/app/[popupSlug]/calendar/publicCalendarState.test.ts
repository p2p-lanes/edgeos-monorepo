import { describe, expect, it } from "vitest"
import type { EventCalendarMeta } from "@/client"
import {
  localDayKey,
  parsePublicCalendarView,
  publicCalendarDefaultDate,
} from "./publicCalendarState"

const meta: EventCalendarMeta = {
  popup_id: "popup",
  popup_slug: "test",
  popup_name: "Test",
  timezone: "America/Argentina/Buenos_Aires",
  popup_start_date: "2026-10-01T00:00:00Z",
  popup_end_date: "2026-10-31T00:00:00Z",
}
const events = [
  { start_time: "2026-10-29T02:00:00Z" }, // Oct 28 in popup time
  { start_time: "2026-10-04T02:00:00Z" }, // Oct 3, not the popup's Oct 1 start
  { start_time: "2026-10-15T12:00:00Z" },
]
const dateFor = (now: string, overrides: Partial<EventCalendarMeta> = {}) =>
  localDayKey(
    publicCalendarDefaultDate({ ...meta, ...overrides }, events, new Date(now)),
  )

describe("public calendar view", () => {
  it.each([
    [null, "list"],
    ["list", "list"],
    ["calendar", "calendar"],
    ["day", "day"],
    ["grid", "list"],
    ["", "list"],
  ])("parses %s as %s", (value, expected) => {
    expect(parsePublicCalendarView(value)).toBe(expected)
  })
})

describe("public calendar initial day", () => {
  it("opens a future popup on the first event day, not its start date", () => {
    expect(dateFor("2025-01-01T12:00:00Z")).toBe("2026-10-03")
  })
  it("opens a past popup on the last event day, not its end date", () => {
    expect(dateFor("2027-01-01T12:00:00Z")).toBe("2026-10-28")
  })
  it("honors ended status even without an end date", () => {
    expect(
      dateFor("2026-10-20T12:00:00Z", {
        popup_ended: true,
        popup_end_date: null,
      }),
    ).toBe("2026-10-28")
  })
  it("keeps today during an ongoing popup even if today has no events", () => {
    expect(dateFor("2026-10-09T01:00:00Z")).toBe("2026-10-08")
  })
  it("treats popup boundaries as nominal dates and includes the whole end day", () => {
    expect(dateFor("2026-10-01T01:00:00Z")).toBe("2026-10-03") // still Sep 30
    expect(dateFor("2026-11-01T01:00:00Z")).toBe("2026-10-31") // still Oct 31
    expect(dateFor("2026-11-01T04:00:00Z")).toBe("2026-10-28")
  })
  it("handles timezones ahead of UTC and cross-year events", () => {
    const result = publicCalendarDefaultDate(
      {
        ...meta,
        timezone: "Pacific/Kiritimati",
        popup_start_date: "2027-01-01T00:00:00Z",
      },
      [{ start_time: "2026-12-31T12:00:00Z" }],
      new Date("2026-12-01T12:00:00Z"),
    )
    expect(localDayKey(result)).toBe("2027-01-01")
  })
  it("falls back to today for empty schedules or unknown dates", () => {
    expect(
      localDayKey(
        publicCalendarDefaultDate(meta, [], new Date("2025-01-01T12:00:00Z")),
      ),
    ).toBe("2025-01-01")
    expect(
      dateFor("2026-09-20T12:00:00Z", {
        popup_start_date: null,
        popup_end_date: null,
      }),
    ).toBe("2026-09-20")
  })
})
