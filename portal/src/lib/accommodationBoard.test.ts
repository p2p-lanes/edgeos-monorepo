/**
 * What the accommodation step offers, and what it says about what it does not.
 *
 * These are the rules a buyer feels: a room they cannot book is not shown,
 * and anything removed for a reason they can act on says so. The wording
 * lives in the components; what is pinned here is which way back exists and
 * which room it points at.
 */
import { describe, expect, it } from "vitest"
import type {
  PublicAccommodation,
  PublicAccommodationAvailability,
} from "@/client"
import {
  addDays,
  bookableBounds,
  buildBoard,
  largestParty,
  recoveriesFor,
  type Stay,
} from "./accommodationBoard"

function room(overrides: Partial<PublicAccommodation> = {}) {
  return {
    id: "room-1",
    property_id: "prop-1",
    product_id: "prod-1",
    name: "Garden Studio",
    kind: "studio",
    guest_capacity: 2,
    default_nightly_price: "145",
    min_stay: 2,
    bookable_from: "2026-08-01",
    bookable_to: "2026-09-30",
    ...overrides,
  } as PublicAccommodation
}

function quote() {
  return {
    nights: [],
    night_count: 3,
    subtotal: "435",
    tax: "43.5",
    total: "478.5",
    applied_rule: "default",
  }
}

function availability(
  overrides: Partial<PublicAccommodationAvailability> = {},
): PublicAccommodationAvailability {
  return {
    accommodation_id: "room-1",
    available: 2,
    quote: quote(),
    ...overrides,
  } as PublicAccommodationAvailability
}

function byId(
  rows: PublicAccommodationAvailability[],
): Map<string, PublicAccommodationAvailability> {
  return new Map(rows.map((row) => [row.accommodation_id, row]))
}

const STAY: Stay = {
  checkIn: "2026-08-09",
  checkOut: "2026-08-12",
  nights: 3,
  guests: 2,
}

describe("buildBoard", () => {
  it("offers a room the server priced and did not refuse", () => {
    const board = buildBoard([room()], byId([availability()]))

    expect(board.bookable.map((entry) => entry.room.id)).toEqual(["room-1"])
    expect(board.blocked).toEqual([])
  })

  it("takes a refused room off the board and keeps its reason", () => {
    const board = buildBoard(
      [room()],
      byId([availability({ available: 0, unavailable_reason: "sold_out" })]),
    )

    expect(board.bookable).toEqual([])
    expect(board.blocked.map((entry) => entry.reason)).toEqual(["sold_out"])
  })

  it("neither shows nor counts a room that is not on sale", () => {
    // "1 room unavailable" about a room the buyer could never have had is
    // noise dressed as information.
    const board = buildBoard(
      [room()],
      byId([availability({ available: 0, unavailable_reason: "inactive" })]),
    )

    expect(board.bookable).toEqual([])
    expect(board.blocked).toEqual([])
  })

  it("holds back a room the server has not answered for", () => {
    const board = buildBoard([room(), room({ id: "room-2" })], byId([]))

    expect(board.bookable).toEqual([])
    expect(board.blocked).toEqual([])
    expect(board.unanswered.map((entry) => entry.id)).toEqual([
      "room-1",
      "room-2",
    ])
  })

  it("will not offer a room with no price, however willing the server is", () => {
    // Selecting it would be selecting a stay at a price nobody has given.
    const board = buildBoard([room()], byId([availability({ quote: null })]))

    expect(board.bookable).toEqual([])
    expect(board.blocked).toEqual([])
    expect(board.unanswered).toHaveLength(1)
  })
})

describe("recoveriesFor", () => {
  it("offers the nearest stay that opens something, not the longest", () => {
    const blocked = buildBoard(
      [
        room({ id: "a", min_stay: 5 }),
        room({ id: "b", min_stay: 4 }),
        room({ id: "c", min_stay: 4 }),
      ],
      byId([
        availability({
          accommodation_id: "a",
          unavailable_reason: "min_stay_not_met",
        }),
        availability({
          accommodation_id: "b",
          unavailable_reason: "min_stay_not_met",
        }),
        availability({
          accommodation_id: "c",
          unavailable_reason: "min_stay_not_met",
        }),
      ]),
    ).blocked

    expect(recoveriesFor(blocked, STAY)).toEqual([
      { kind: "extend_stay", nights: 4, rooms: 2 },
    ])
  })

  it("points at the soonest room to open, and counts only that day's", () => {
    const blocked = buildBoard(
      [
        room({ id: "a", bookable_from: "2026-10-01" }),
        room({ id: "b", bookable_from: "2026-09-15" }),
        room({ id: "c", bookable_from: "2026-09-15" }),
      ],
      byId(
        ["a", "b", "c"].map((id) =>
          availability({
            accommodation_id: id,
            unavailable_reason: "outside_bookable_window",
          }),
        ),
      ),
    ).blocked

    expect(recoveriesFor(blocked, STAY)).toEqual([
      { kind: "opens_later", date: "2026-09-15", rooms: 2 },
    ])
  })

  it("tells a room that has not opened from one that has closed", () => {
    // "Opens on" and "closed on" are opposite instructions, and a window miss
    // is either one depending on which side of it the stay falls.
    const blocked = buildBoard(
      [
        room({
          id: "past",
          bookable_from: "2026-06-01",
          bookable_to: "2026-08-10",
        }),
        room({ id: "future", bookable_from: "2026-11-01" }),
      ],
      byId(
        ["past", "future"].map((id) =>
          availability({
            accommodation_id: id,
            unavailable_reason: "outside_bookable_window",
          }),
        ),
      ),
    ).blocked

    expect(recoveriesFor(blocked, STAY)).toEqual([
      { kind: "opens_later", date: "2026-11-01", rooms: 1 },
      { kind: "closed_earlier", date: "2026-08-10", rooms: 1 },
    ])
  })

  it("says how big the biggest room actually is", () => {
    const blocked = buildBoard(
      [
        room({ id: "a", guest_capacity: 2 }),
        room({ id: "b", guest_capacity: 4 }),
      ],
      byId(
        ["a", "b"].map((id) =>
          availability({
            accommodation_id: id,
            unavailable_reason: "over_capacity",
          }),
        ),
      ),
    ).blocked

    expect(recoveriesFor(blocked, { ...STAY, guests: 6 })).toEqual([
      { kind: "party_too_big", rooms: 2, largest: 4 },
    ])
  })

  it("counts what is taken and offers nothing, because there is nothing", () => {
    // Finding the next free dates needs a search the server does not offer.
    const blocked = buildBoard(
      [room()],
      byId([availability({ available: 0, unavailable_reason: "sold_out" })]),
    ).blocked

    expect(recoveriesFor(blocked, STAY)).toEqual([{ kind: "taken", rooms: 1 }])
  })

  it("puts what a button can fix above what it cannot", () => {
    const blocked = buildBoard(
      [
        room({ id: "taken" }),
        room({ id: "short", min_stay: 4 }),
        room({ id: "big", guest_capacity: 1 }),
      ],
      byId([
        availability({
          accommodation_id: "taken",
          unavailable_reason: "sold_out",
        }),
        availability({
          accommodation_id: "short",
          unavailable_reason: "min_stay_not_met",
        }),
        availability({
          accommodation_id: "big",
          unavailable_reason: "over_capacity",
        }),
      ]),
    ).blocked

    expect(recoveriesFor(blocked, STAY).map((item) => item.kind)).toEqual([
      "extend_stay",
      "party_too_big",
      "taken",
    ])
  })

  it("says nothing when nothing was removed", () => {
    expect(recoveriesFor([], STAY)).toEqual([])
  })
})

describe("date and offer bounds", () => {
  it("adds days across a month end without going through UTC", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02")
  })

  it("spans every room's window", () => {
    expect(
      bookableBounds([
        room({ bookable_from: "2026-08-01", bookable_to: "2026-08-31" }),
        room({ bookable_from: "2026-07-15", bookable_to: "2026-09-30" }),
      ]),
    ).toEqual({ from: "2026-07-15", to: "2026-09-30" })
  })

  it("has no bounds without an offer", () => {
    expect(bookableBounds([])).toEqual({ from: null, to: null })
  })

  it("caps the party at the biggest room on offer", () => {
    expect(
      largestParty([room({ guest_capacity: 2 }), room({ guest_capacity: 6 })]),
    ).toBe(6)
  })
})
