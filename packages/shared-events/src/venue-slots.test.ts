import { describe, expect, it } from "vitest"
import {
  availableStartOptionsForDuration,
  dayBoundsInTz,
  durationFits,
  freeIntervalsForDay,
  localTzNaiveToUtc,
  monthBoundsInTz,
  tzOffsetMinutes,
  utcToLocalTzNaive,
} from "./venue-slots"

// All TZ logic flows through `Intl.DateTimeFormat`'s `timeZone` option, so
// these tests are independent of the host machine's TZ — they pass on
// Windows, Linux, macOS, and CI without setting `process.env.TZ`.

describe("dayBoundsInTz", () => {
  it("LA midnight 2026-06-04 → 07:00Z to next-day 07:00Z (DST: UTC-7)", () => {
    const { start, end } = dayBoundsInTz("2026-06-04", "America/Los_Angeles")
    expect(start.toISOString()).toBe("2026-06-04T07:00:00.000Z")
    expect(end.toISOString()).toBe("2026-06-05T07:00:00.000Z")
  })

  it("Tokyo midnight 2026-06-04 → prev-day 15:00Z (UTC+9)", () => {
    const { start } = dayBoundsInTz("2026-06-04", "Asia/Tokyo")
    expect(start.toISOString()).toBe("2026-06-03T15:00:00.000Z")
  })

  it("US/Pacific spring-forward 2026-03-08 day bound still anchors to wall-clock midnight", () => {
    // 2026-03-08 02:00 local jumps to 03:00; the day before is UTC-8, the
    // day itself is UTC-7. Midnight wall-clock on 03-08 is still
    // 08:00Z (one UTC-8 hour after the bound at midnight before the DST gap).
    const { start, end } = dayBoundsInTz("2026-03-08", "America/Los_Angeles")
    expect(start.toISOString()).toBe("2026-03-08T08:00:00.000Z")
    // 23h day across spring-forward.
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it("range is exactly 24h for a non-DST day", () => {
    const { start, end } = dayBoundsInTz("2026-06-04", "America/Los_Angeles")
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000)
  })
})

describe("monthBoundsInTz", () => {
  it("LA June 2026 → 06-01 07:00Z to 07-01 07:00Z", () => {
    const anchor = new Date("2026-06-15T12:00:00Z")
    const { start, end } = monthBoundsInTz(anchor, "America/Los_Angeles")
    expect(start.toISOString()).toBe("2026-06-01T07:00:00.000Z")
    expect(end.toISOString()).toBe("2026-07-01T07:00:00.000Z")
  })

  it("Tokyo June 2026 → 05-31 15:00Z to 06-30 15:00Z", () => {
    const anchor = new Date("2026-06-15T12:00:00Z")
    const { start, end } = monthBoundsInTz(anchor, "Asia/Tokyo")
    expect(start.toISOString()).toBe("2026-05-31T15:00:00.000Z")
    expect(end.toISOString()).toBe("2026-06-30T15:00:00.000Z")
  })

  it("wraps year on December anchor", () => {
    const anchor = new Date("2026-12-20T12:00:00Z")
    const { start, end } = monthBoundsInTz(anchor, "America/Los_Angeles")
    expect(start.toISOString()).toBe("2026-12-01T08:00:00.000Z")
    expect(end.toISOString()).toBe("2027-01-01T08:00:00.000Z")
  })

  it("uses the popup-tz month even when the anchor instant is in a different month in browser-local time", () => {
    // 2026-07-01 00:30Z is "2026-06-30 17:30" in LA — the anchor's LA
    // month is June, so bounds must wrap the June interval (not July).
    const anchor = new Date("2026-07-01T00:30:00Z")
    const { start, end } = monthBoundsInTz(anchor, "America/Los_Angeles")
    expect(start.toISOString()).toBe("2026-06-01T07:00:00.000Z")
    expect(end.toISOString()).toBe("2026-07-01T07:00:00.000Z")
  })
})

describe("localTzNaiveToUtc", () => {
  it("'2026-06-04T13:00' in LA → 20:00Z (DST UTC-7)", () => {
    expect(
      localTzNaiveToUtc("2026-06-04T13:00", "America/Los_Angeles").toISOString(),
    ).toBe("2026-06-04T20:00:00.000Z")
  })

  it("same naive interpreted in Tokyo gives a different UTC instant", () => {
    expect(
      localTzNaiveToUtc("2026-06-04T13:00", "Asia/Tokyo").toISOString(),
    ).toBe("2026-06-04T04:00:00.000Z")
  })

  it("naive without time defaults to 00:00 in the popup TZ", () => {
    expect(
      localTzNaiveToUtc("2026-06-04", "America/Los_Angeles").toISOString(),
    ).toBe("2026-06-04T07:00:00.000Z")
  })

  it("round-trips with utcToLocalTzNaive", () => {
    const naive = "2026-06-04T13:00"
    const tz = "America/Los_Angeles"
    const utc = localTzNaiveToUtc(naive, tz).toISOString()
    expect(utcToLocalTzNaive(utc, tz)).toBe(naive)
  })
})

describe("utcToLocalTzNaive", () => {
  it("UTC 2026-06-04T20:00Z projected in LA → '2026-06-04T13:00'", () => {
    expect(
      utcToLocalTzNaive("2026-06-04T20:00:00Z", "America/Los_Angeles"),
    ).toBe("2026-06-04T13:00")
  })

  it("event crossing UTC midnight stays on the right local day in LA", () => {
    // 06:00Z on 2026-06-04 == 23:00 on 2026-06-03 in LA (UTC-7).
    expect(
      utcToLocalTzNaive("2026-06-04T06:00:00Z", "America/Los_Angeles"),
    ).toBe("2026-06-03T23:00")
  })

  it("returns empty string for empty/invalid inputs", () => {
    expect(utcToLocalTzNaive("", "America/Los_Angeles")).toBe("")
    expect(utcToLocalTzNaive("not-a-date", "America/Los_Angeles")).toBe("")
  })
})

describe("tzOffsetMinutes", () => {
  const sample = Date.UTC(2026, 5, 4, 12, 0, 0) // 2026-06-04T12:00:00Z

  it("UTC → 0", () => {
    expect(tzOffsetMinutes(sample, "UTC")).toBe(0)
  })

  it("Buenos Aires (UTC-3) → -180", () => {
    expect(tzOffsetMinutes(sample, "America/Argentina/Buenos_Aires")).toBe(-180)
  })

  it("Tokyo (UTC+9) → 540", () => {
    expect(tzOffsetMinutes(sample, "Asia/Tokyo")).toBe(540)
  })

  it("Sydney DST transition flips offset", () => {
    // Sydney is UTC+11 (AEDT) until early April, then UTC+10 (AEST).
    // 2026-04-04 14:00Z = 2026-04-05 01:00 AEDT (still DST).
    // 2026-04-05 14:00Z = 2026-04-06 00:00 AEST (after fallback).
    const beforeFallback = Date.UTC(2026, 3, 4, 14, 0, 0)
    const afterFallback = Date.UTC(2026, 3, 5, 14, 0, 0)
    expect(tzOffsetMinutes(beforeFallback, "Australia/Sydney")).toBe(11 * 60)
    expect(tzOffsetMinutes(afterFallback, "Australia/Sydney")).toBe(10 * 60)
  })
})

describe("freeIntervalsForDay + availableStartOptionsForDuration", () => {
  const tz = "America/Los_Angeles"
  const { start: dayStart, end: dayEnd } = dayBoundsInTz("2026-06-04", tz)

  // Helper: open range in LA wall-clock, returned as UTC ISO strings.
  function openLA(startHHMM: string, endHHMM: string) {
    return {
      start: localTzNaiveToUtc(`2026-06-04T${startHHMM}`, tz).toISOString(),
      end: localTzNaiveToUtc(`2026-06-04T${endHHMM}`, tz).toISOString(),
    }
  }

  it("open 09:00-22:00 LA with no busy yields a single free interval covering it", () => {
    const free = freeIntervalsForDay(
      [openLA("09:00", "22:00")],
      [],
      dayStart,
      dayEnd,
    )
    expect(free).toHaveLength(1)
    const options = availableStartOptionsForDuration(free, 30, 30, tz)
    expect(options[0]?.label).toBe("09:00")
    expect(options.at(-1)?.label).toBe("21:30")
  })

  it("open 09:00-17:00 LA with busy 12:00-14:00 yields 2 sub-intervals", () => {
    const busy = {
      ...openLA("12:00", "14:00"),
      source: "event",
      label: "Lunch",
    }
    const free = freeIntervalsForDay(
      [openLA("09:00", "17:00")],
      [busy],
      dayStart,
      dayEnd,
    )
    expect(free).toHaveLength(2)
    // The boundary between the two free intervals should fall on the
    // busy block — start of busy is the end of first free interval.
    expect(free[0]?.end).toBe(Date.parse(busy.start))
    expect(free[1]?.start).toBe(Date.parse(busy.end))
  })

  it("step=30min with duration=90min: last valid start is 15:30 when free ends at 17:00", () => {
    const free = freeIntervalsForDay(
      [openLA("09:00", "17:00")],
      [],
      dayStart,
      dayEnd,
    )
    const options = availableStartOptionsForDuration(free, 90, 30, tz)
    expect(options.at(-1)?.label).toBe("15:30")
  })
})

describe("durationFits", () => {
  const tz = "America/Los_Angeles"
  const { start: dayStart, end: dayEnd } = dayBoundsInTz("2026-06-04", tz)
  const open = {
    start: localTzNaiveToUtc("2026-06-04T09:00", tz).toISOString(),
    end: localTzNaiveToUtc("2026-06-04T17:00", tz).toISOString(),
  }
  const free = freeIntervalsForDay([open], [], dayStart, dayEnd)

  it("fits when start + duration stays inside the free interval", () => {
    const start = localTzNaiveToUtc("2026-06-04T13:00", tz).getTime()
    expect(durationFits(free, start, 60)).toBe(true)
  })

  it("does not fit when the end exceeds the free interval", () => {
    const start = localTzNaiveToUtc("2026-06-04T16:30", tz).getTime()
    expect(durationFits(free, start, 60)).toBe(false)
  })
})
