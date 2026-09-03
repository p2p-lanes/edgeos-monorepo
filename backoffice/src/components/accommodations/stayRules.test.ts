/**
 * The rules the booking dialog refuses on.
 *
 * These cases mirror `TestStayRestrictions` in the backend's
 * `test_availability.py`, because the
 * point of the client copy is that the two agree: a stay the dialog accepts
 * and the API then refuses is worse than no client check at all, and so is a
 * stay the dialog refuses that the API would have taken.
 */

import { describe, expect, it } from "vitest"
import { checkStay, effectiveMinStay, type StayRules } from "./stayRules"

const room: StayRules = {
  name: "Classic Double",
  bookable_from: "2026-06-12",
  bookable_to: "2026-06-24",
  guest_capacity: 2,
  is_active: true,
}

describe("checkStay", () => {
  it("takes a stay inside the window", () => {
    expect(
      checkStay(room, { checkIn: "2026-06-14", checkOut: "2026-06-19" }),
    ).toBeNull()
  })

  it("takes a stay that ends exactly on bookable_to", () => {
    // The boundary that reads wrong to everyone: `bookable_to` is a check-out
    // bound, so leaving on the 24th is inside the window even though nobody
    // can sleep the night of the 24th.
    expect(
      checkStay(room, { checkIn: "2026-06-20", checkOut: "2026-06-24" }),
    ).toBeNull()
  })

  it("refuses a stay that would sleep the night of bookable_to", () => {
    const problem = checkStay(room, {
      checkIn: "2026-06-20",
      checkOut: "2026-06-25",
    })

    expect(problem?.field).toBe("dates")
    expect(problem?.title).toBe("These dates are outside the booking window")
  })

  it("takes a stay that starts exactly on bookable_from, and refuses the night before", () => {
    expect(
      checkStay(room, { checkIn: "2026-06-12", checkOut: "2026-06-14" }),
    ).toBeNull()
    expect(
      checkStay(room, { checkIn: "2026-06-11", checkOut: "2026-06-14" })?.field,
    ).toBe("dates")
  })

  it("says the window in nights, never quoting the check-out day as a night", () => {
    const problem = checkStay(room, {
      checkIn: "2026-06-01",
      checkOut: "2026-06-03",
    })

    expect(problem?.detail).toContain("nights of Jun 12 to Jun 23")
    expect(problem?.detail).toContain("out by Jun 24")
  })

  it("refuses a check-out on or before check-in", () => {
    expect(
      checkStay(room, { checkIn: "2026-06-14", checkOut: "2026-06-14" })?.title,
    ).toBe("Check-out must be after check-in")
  })

  it("refuses a stay under the room's own minimum and names the first date that works", () => {
    const problem = checkStay(
      { ...room, min_stay_override: 3 },
      { checkIn: "2026-06-14", checkOut: "2026-06-16" },
    )

    expect(problem?.title).toBe("Classic Double has a 3-night minimum")
    expect(problem?.detail).toContain("cover 2 nights")
    expect(problem?.detail).toContain("Jun 17")
  })

  it("falls back to the gathering's minimum when the room sets none", () => {
    const stay = { checkIn: "2026-06-14", checkOut: "2026-06-15" }

    expect(checkStay(room, stay, 2)?.field).toBe("dates")
    expect(checkStay(room, stay, 1)).toBeNull()
    expect(checkStay(room, stay)).toBeNull()
  })

  it("prefers the room's override to the gathering's default, in both directions", () => {
    expect(effectiveMinStay({ min_stay_override: 5 }, 2)).toBe(5)
    expect(effectiveMinStay({ min_stay_override: 1 }, 7)).toBe(1)
    expect(effectiveMinStay({ min_stay_override: null }, 7)).toBe(7)
    expect(effectiveMinStay({ min_stay_override: null })).toBe(1)
  })

  it("refuses more guests than the room sleeps", () => {
    const problem = checkStay(room, {
      checkIn: "2026-06-14",
      checkOut: "2026-06-16",
      guests: 3,
    })

    expect(problem?.field).toBe("guests")
    expect(problem?.title).toBe("Classic Double sleeps 2 guests")
  })

  it("refuses a room type that is switched off, before looking at the dates", () => {
    // Order matters: fixing the dates would not help, and reporting the dates
    // first would send the operator down the wrong path.
    const problem = checkStay(
      { ...room, is_active: false },
      { checkIn: "2026-01-01", checkOut: "2026-01-02" },
    )

    expect(problem?.field).toBe("room")
    expect(problem?.title).toBe("Classic Double is switched off")
  })

  it("reports the window before the minimum stay, as the backend does", () => {
    // A stay that breaks both: the operator must be told the same thing by
    // both sides, or fixing one refusal just produces the other.
    const problem = checkStay(
      { ...room, min_stay_override: 4 },
      { checkIn: "2026-06-30", checkOut: "2026-07-01" },
    )

    expect(problem?.title).toBe("These dates are outside the booking window")
  })
})
