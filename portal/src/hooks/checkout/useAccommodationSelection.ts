import { useCallback, useState } from "react"
import type { SelectedAccommodationItem } from "@/types/checkout"

/**
 * Rooms the buyer has put in the cart.
 *
 * A list, not a single selection: a family books two rooms, and the same room
 * type can appear twice for different dates. The identity of an entry is
 * therefore (accommodation, check-in, check-out). Adding the same room for
 * the same nights twice is a double-click, not a second room, and the backend
 * would refuse it anyway when the second line finds no free unit.
 *
 * Nothing here computes a price. `totalPrice` is whatever the availability
 * endpoint quoted for those dates; when the dates change the entry is dropped
 * rather than re-priced client-side, because the only trustworthy quote is the
 * one the server just gave us.
 */

export function entryKey(item: {
  accommodationId: string
  checkIn: string
  checkOut: string
}): string {
  return `${item.accommodationId}|${item.checkIn}|${item.checkOut}`
}

export function useAccommodationSelection() {
  const [accommodations, setAccommodations] = useState<
    SelectedAccommodationItem[]
  >([])

  const addAccommodation = useCallback((item: SelectedAccommodationItem) => {
    setAccommodations((prev) => {
      if (prev.some((entry) => entryKey(entry) === entryKey(item))) return prev
      return [...prev, item]
    })
  }, [])

  const removeAccommodation = useCallback(
    (accommodationId: string, checkIn: string, checkOut: string) => {
      const key = entryKey({ accommodationId, checkIn, checkOut })
      setAccommodations((prev) =>
        prev.filter((entry) => entryKey(entry) !== key),
      )
    },
    [],
  )

  /**
   * Resize the party in one booking.
   *
   * The guest-name list is grown and trimmed to match: dropping from three
   * guests to two must not leave a third name behind to be submitted, and
   * growing must leave an empty slot for the buyer to fill rather than
   * silently under-reporting the party.
   */
  const setAccommodationGuestCount = useCallback(
    (
      accommodationId: string,
      checkIn: string,
      checkOut: string,
      guestCount: number,
    ) => {
      const key = entryKey({ accommodationId, checkIn, checkOut })
      setAccommodations((prev) =>
        prev.map((entry) => {
          if (entryKey(entry) !== key) return entry
          const next = Math.max(1, Math.floor(guestCount))
          const guests = Array.from(
            { length: next },
            (_, index) => entry.guests[index] ?? "",
          )
          return { ...entry, guestCount: next, guests }
        }),
      )
    },
    [],
  )

  const setAccommodationGuestName = useCallback(
    (
      accommodationId: string,
      checkIn: string,
      checkOut: string,
      index: number,
      name: string,
    ) => {
      const key = entryKey({ accommodationId, checkIn, checkOut })
      setAccommodations((prev) =>
        prev.map((entry) => {
          if (entryKey(entry) !== key) return entry
          const guests = [...entry.guests]
          guests[index] = name
          return { ...entry, guests }
        }),
      )
    },
    [],
  )

  /**
   * Drop everything booked for a different date range.
   *
   * Called when the buyer changes the dates: the quotes in the cart were for
   * the old nights, and keeping them would charge for a stay nobody chose.
   */
  const clearAccommodationsOutsideStay = useCallback(
    (checkIn: string, checkOut: string) => {
      setAccommodations((prev) =>
        prev.filter(
          (entry) => entry.checkIn === checkIn && entry.checkOut === checkOut,
        ),
      )
    },
    [],
  )

  return {
    accommodations,
    setAccommodations,
    addAccommodation,
    removeAccommodation,
    setAccommodationGuestCount,
    setAccommodationGuestName,
    clearAccommodationsOutsideStay,
  }
}
