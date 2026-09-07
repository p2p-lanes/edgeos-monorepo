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

  /** Apply a change to the one entry identified by (room, check-in, out). */
  const patchEntry = useCallback(
    (
      accommodationId: string,
      checkIn: string,
      checkOut: string,
      patch: (entry: SelectedAccommodationItem) => SelectedAccommodationItem,
    ) => {
      const key = entryKey({ accommodationId, checkIn, checkOut })
      setAccommodations((prev) =>
        prev.map((entry) => (entryKey(entry) === key ? patch(entry) : entry)),
      )
    },
    [],
  )

  /**
   * Resize the party in one booking.
   *
   * The guest list is grown and trimmed to match: dropping from three guests
   * to two must not leave a third behind to be submitted, and growing must
   * leave an empty slot for the buyer to fill rather than silently
   * under-reporting the party. Answers already typed into the slots that
   * survive are kept, because resizing a party is not a reason to make
   * someone retype their passport number.
   */
  const setAccommodationGuestCount = useCallback(
    (
      accommodationId: string,
      checkIn: string,
      checkOut: string,
      guestCount: number,
    ) => {
      patchEntry(accommodationId, checkIn, checkOut, (entry) => {
        const next = Math.max(1, Math.floor(guestCount))
        const guests = Array.from(
          { length: next },
          (_, index) => entry.guests[index] ?? { name: "", answers: {} },
        )
        return { ...entry, guestCount: next, guests }
      })
    },
    [patchEntry],
  )

  const setAccommodationGuestName = useCallback(
    (
      accommodationId: string,
      checkIn: string,
      checkOut: string,
      index: number,
      name: string,
    ) => {
      patchEntry(accommodationId, checkIn, checkOut, (entry) => {
        const guests = [...entry.guests]
        guests[index] = { ...(guests[index] ?? { answers: {} }), name }
        return { ...entry, guests }
      })
    },
    [patchEntry],
  )

  /** One answer from whoever the room is for. */
  const setAccommodationBookerAnswer = useCallback(
    (
      accommodationId: string,
      checkIn: string,
      checkOut: string,
      key: string,
      value: unknown,
    ) => {
      patchEntry(accommodationId, checkIn, checkOut, (entry) => ({
        ...entry,
        bookerAnswers: { ...entry.bookerAnswers, [key]: value },
      }))
    },
    [patchEntry],
  )

  /** One answer from one occupant, by position. */
  const setAccommodationGuestAnswer = useCallback(
    (
      accommodationId: string,
      checkIn: string,
      checkOut: string,
      index: number,
      key: string,
      value: unknown,
    ) => {
      patchEntry(accommodationId, checkIn, checkOut, (entry) => {
        const guests = [...entry.guests]
        const guest = guests[index] ?? { name: "", answers: {} }
        guests[index] = {
          ...guest,
          answers: { ...guest.answers, [key]: value },
        }
        return { ...entry, guests }
      })
    },
    [patchEntry],
  )

  /**
   * Copy the lead guest's answers onto one occupant.
   *
   * Only the keys the two sections share, and never the name: a couple
   * travelling together share a phone number and an address, not a name.
   */
  const copyBookerAnswersToGuest = useCallback(
    (
      accommodationId: string,
      checkIn: string,
      checkOut: string,
      index: number,
      keys: string[],
    ) => {
      patchEntry(accommodationId, checkIn, checkOut, (entry) => {
        const guests = [...entry.guests]
        const guest = guests[index] ?? { name: "", answers: {} }
        const copied: Record<string, unknown> = { ...guest.answers }
        for (const key of keys) {
          if (entry.bookerAnswers[key] !== undefined) {
            copied[key] = entry.bookerAnswers[key]
          }
        }
        guests[index] = { ...guest, answers: copied }
        return { ...entry, guests }
      })
    },
    [patchEntry],
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
    setAccommodationBookerAnswer,
    setAccommodationGuestAnswer,
    copyBookerAnswersToGuest,
    clearAccommodationsOutsideStay,
  }
}
