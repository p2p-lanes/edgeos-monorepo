/**
 * Calendar geometry.
 *
 * Every case here is one an operator would notice immediately and could not
 * diagnose: a bar one day too wide, a stay that starts before the visible
 * month drawn from the wrong edge, or two guests whose turnover day overlaps
 * so the room looks double-booked when it is not.
 */

import { describe, expect, it } from "vitest"
import type { CalendarBooking } from "@/client"
import {
  addDays,
  closedDays,
  DAY_WIDTH,
  dayOffset,
  eachDay,
  isWeekend,
  layoutBooking,
  layoutBookings,
  monthWindow,
  shiftMonth,
} from "./calendarLayout"

function booking(
  check_in: string,
  check_out: string,
  id = `${check_in}/${check_out}`,
): CalendarBooking {
  return {
    id,
    unit_id: "unit",
    accommodation_id: "room",
    kind: "guest",
    status: "confirmed",
    check_in,
    check_out,
    nights: dayOffset(check_out, check_in),
  }
}

describe("date helpers", () => {
  it("counts whole days between two keys, in both directions", () => {
    expect(dayOffset("2026-03-10", "2026-03-01")).toBe(9)
    expect(dayOffset("2026-02-25", "2026-03-01")).toBe(-4)
  })

  it("crosses month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    // 2028 is a leap year, so February has a 29th to land on.
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29")
  })

  it("renders the half-open window as columns, excluding the end", () => {
    expect(eachDay("2026-03-01", "2026-03-04")).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
    ])
    expect(eachDay("2026-03-01", "2026-03-01")).toEqual([])
  })

  it("spans a whole month, February included", () => {
    expect(monthWindow("2026-02-17")).toEqual({
      from: "2026-02-01",
      to: "2026-03-01",
    })
    expect(eachDay("2026-02-01", "2026-03-01")).toHaveLength(28)
  })

  it("steps months without drifting off a 31st", () => {
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-01")
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-01")
  })

  it("knows the weekend regardless of the browser timezone", () => {
    expect(isWeekend("2026-03-07")).toBe(true) // Saturday
    expect(isWeekend("2026-03-08")).toBe(true) // Sunday
    expect(isWeekend("2026-03-09")).toBe(false)
  })
})

describe("layoutBooking", () => {
  const from = "2026-03-01"
  const to = "2026-04-01"

  it("starts mid-column and is one day wide per night", () => {
    const bar = layoutBooking(booking("2026-03-01", "2026-03-04"), from, to)

    expect(bar).not.toBeNull()
    expect(bar?.left).toBe(DAY_WIDTH / 2)
    expect(bar?.width).toBe(3 * DAY_WIDTH)
    expect(bar?.openStart).toBe(false)
    expect(bar?.openEnd).toBe(false)
  })

  it("lets the departing and arriving guest share the turnover day", () => {
    const leaving = layoutBooking(booking("2026-03-01", "2026-03-05"), from, to)
    const arriving = layoutBooking(
      booking("2026-03-05", "2026-03-08"),
      from,
      to,
    )

    // The 5th is column 4: the first bar ends at its midpoint and the second
    // starts there, so neither claims the whole cell.
    const midpointOfFifth = 4 * DAY_WIDTH + DAY_WIDTH / 2
    expect((leaving?.left ?? 0) + (leaving?.width ?? 0)).toBe(midpointOfFifth)
    expect(arriving?.left).toBe(midpointOfFifth)
  })

  it("clips a stay that began before the window and flags the open edge", () => {
    const bar = layoutBooking(booking("2026-02-25", "2026-03-03"), from, to)

    expect(bar?.left).toBe(0)
    expect(bar?.openStart).toBe(true)
    expect(bar?.openEnd).toBe(false)
    expect(bar?.width).toBe(2 * DAY_WIDTH + DAY_WIDTH / 2)
  })

  it("clips a stay that runs past the window", () => {
    const bar = layoutBooking(booking("2026-03-30", "2026-04-05"), from, to)
    const totalWidth = 31 * DAY_WIDTH

    expect(bar?.openEnd).toBe(true)
    expect((bar?.left ?? 0) + (bar?.width ?? 0)).toBe(totalWidth)
  })

  it("drops a stay that does not touch the window at all", () => {
    expect(layoutBooking(booking("2026-01-05", "2026-01-09"), from, to)).toBe(
      null,
    )
    expect(layoutBooking(booking("2026-05-05", "2026-05-09"), from, to)).toBe(
      null,
    )
  })

  it("still shows the morning of a checkout on the first visible day", () => {
    // The guest sleeps no night inside the window, but they are in the room
    // on the morning of the 1st and the server returns the stay for exactly
    // that reason. Half a cell is the same thing every other turnover day
    // draws, so the operator reads "checkout here", not "room taken".
    const bar = layoutBooking(booking("2026-02-26", "2026-03-01"), from, to)

    expect(bar?.left).toBe(0)
    expect(bar?.width).toBe(DAY_WIDTH / 2)
    expect(bar?.openStart).toBe(true)
  })
})

describe("layoutBookings", () => {
  it("orders bars left to right and skips the ones out of range", () => {
    const bars = layoutBookings(
      [
        booking("2026-03-20", "2026-03-22", "late"),
        booking("2026-01-01", "2026-01-02", "elsewhere"),
        booking("2026-03-02", "2026-03-04", "early"),
      ],
      "2026-03-01",
      "2026-04-01",
    )

    expect(bars.map((bar) => bar.booking.id)).toEqual(["early", "late"])
  })
})

describe("closedDays", () => {
  const march = eachDay("2026-03-01", "2026-04-01")

  it("closes the nights on either side of the bookable window", () => {
    const closed = closedDays(march, {
      bookable_from: "2026-03-10",
      bookable_to: "2026-03-20",
    })

    expect(closed.has("2026-03-09")).toBe(true)
    expect(closed.has("2026-03-10")).toBe(false)
    expect(closed.size).toBe(march.length - 10)
  })

  it("treats bookable_to as a check-out date, so its own night is closed", () => {
    // A guest may check out on the 20th, which means the last night anyone can
    // sleep is the 19th. Counting the 20th as sellable would offer a night the
    // checkout refuses.
    const closed = closedDays(march, {
      bookable_from: "2026-03-10",
      bookable_to: "2026-03-20",
    })

    expect(closed.has("2026-03-19")).toBe(false)
    expect(closed.has("2026-03-20")).toBe(true)
  })

  it("closes every visible night when the room type is switched off", () => {
    const closed = closedDays(march, {
      bookable_from: "2026-03-01",
      bookable_to: "2026-04-01",
      is_active: false,
    })

    expect(closed.size).toBe(march.length)
  })

  it("closes nothing when the window covers the whole view", () => {
    const closed = closedDays(march, {
      bookable_from: "2026-01-01",
      bookable_to: "2027-01-01",
      is_active: true,
    })

    expect(closed.size).toBe(0)
  })
})
