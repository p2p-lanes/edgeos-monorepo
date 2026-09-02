/**
 * The accommodation cart slice.
 *
 * The invariants worth protecting are the ones a buyer would notice: two
 * rooms of the same type for different weeks are two bookings, resizing a
 * party must not leave a stranger's name behind, and moving the dates must
 * take the old quotes with it rather than re-charging them.
 */
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { SelectedAccommodationItem } from "@/types/checkout"
import {
  entryKey,
  useAccommodationSelection,
} from "./useAccommodationSelection"

function room(
  overrides: Partial<SelectedAccommodationItem> = {},
): SelectedAccommodationItem {
  return {
    accommodationId: "room-1",
    productId: "prod-1",
    name: "Double Room",
    propertyId: "prop-1",
    propertyName: "Hotel Arcadia",
    checkIn: "2026-06-01",
    checkOut: "2026-06-08",
    nights: 7,
    guestCount: 1,
    guests: [""],
    subtotal: 840,
    tax: 84,
    totalPrice: 924,
    ...overrides,
  }
}

describe("entryKey", () => {
  it("identifies a booking by its room and its nights", () => {
    // Not by room alone: the same room type booked for two different weeks is
    // two bookings, and each gets its own unit.
    expect(entryKey(room())).not.toBe(
      entryKey(room({ checkIn: "2026-06-10", checkOut: "2026-06-12" })),
    )
  })
})

describe("useAccommodationSelection", () => {
  it("adds a room", () => {
    const { result } = renderHook(() => useAccommodationSelection())
    act(() => result.current.addAccommodation(room()))

    expect(result.current.accommodations).toHaveLength(1)
    expect(result.current.accommodations[0].totalPrice).toBe(924)
  })

  it("ignores the same room for the same nights twice", () => {
    // A double-click, not a second room, and the backend would refuse the
    // second line anyway when it found no free unit.
    const { result } = renderHook(() => useAccommodationSelection())
    act(() => {
      result.current.addAccommodation(room())
      result.current.addAccommodation(room())
    })

    expect(result.current.accommodations).toHaveLength(1)
  })

  it("keeps the same room booked for two different stays", () => {
    const { result } = renderHook(() => useAccommodationSelection())
    act(() => {
      result.current.addAccommodation(room())
      result.current.addAccommodation(
        room({ checkIn: "2026-06-20", checkOut: "2026-06-22" }),
      )
    })

    expect(result.current.accommodations).toHaveLength(2)
  })

  it("removes one booking without touching the other", () => {
    const { result } = renderHook(() => useAccommodationSelection())
    act(() => {
      result.current.addAccommodation(room())
      result.current.addAccommodation(
        room({ accommodationId: "room-2", name: "Suite" }),
      )
    })
    act(() =>
      result.current.removeAccommodation("room-1", "2026-06-01", "2026-06-08"),
    )

    expect(result.current.accommodations.map((r) => r.accommodationId)).toEqual(
      ["room-2"],
    )
  })

  it("grows the name slots when the party grows", () => {
    const { result } = renderHook(() => useAccommodationSelection())
    act(() => result.current.addAccommodation(room()))
    act(() =>
      result.current.setAccommodationGuestCount(
        "room-1",
        "2026-06-01",
        "2026-06-08",
        3,
      ),
    )

    expect(result.current.accommodations[0].guestCount).toBe(3)
    expect(result.current.accommodations[0].guests).toEqual(["", "", ""])
  })

  it("drops the trailing name when the party shrinks", () => {
    // Otherwise a third guest who was removed still travels to the backend
    // and ends up on the property owner's list.
    const { result } = renderHook(() => useAccommodationSelection())
    act(() =>
      result.current.addAccommodation(
        room({ guestCount: 3, guests: ["Ada", "Grace", "Katherine"] }),
      ),
    )
    act(() =>
      result.current.setAccommodationGuestCount(
        "room-1",
        "2026-06-01",
        "2026-06-08",
        2,
      ),
    )

    expect(result.current.accommodations[0].guests).toEqual(["Ada", "Grace"])
  })

  it("never lets the party drop below one", () => {
    const { result } = renderHook(() => useAccommodationSelection())
    act(() => result.current.addAccommodation(room()))
    act(() =>
      result.current.setAccommodationGuestCount(
        "room-1",
        "2026-06-01",
        "2026-06-08",
        0,
      ),
    )

    expect(result.current.accommodations[0].guestCount).toBe(1)
  })

  it("writes a guest name into its own slot", () => {
    const { result } = renderHook(() => useAccommodationSelection())
    act(() =>
      result.current.addAccommodation(
        room({ guestCount: 2, guests: ["", ""] }),
      ),
    )
    act(() =>
      result.current.setAccommodationGuestName(
        "room-1",
        "2026-06-01",
        "2026-06-08",
        1,
        "Grace",
      ),
    )

    expect(result.current.accommodations[0].guests).toEqual(["", "Grace"])
  })

  it("drops rooms quoted for other dates when the stay moves", () => {
    // Their prices were for the old nights; keeping them would charge for a
    // stay nobody chose.
    const { result } = renderHook(() => useAccommodationSelection())
    act(() => {
      result.current.addAccommodation(room())
      result.current.addAccommodation(
        room({
          accommodationId: "room-2",
          checkIn: "2026-07-01",
          checkOut: "2026-07-03",
        }),
      )
    })
    act(() =>
      result.current.clearAccommodationsOutsideStay("2026-07-01", "2026-07-03"),
    )

    expect(result.current.accommodations.map((r) => r.accommodationId)).toEqual(
      ["room-2"],
    )
  })
})
