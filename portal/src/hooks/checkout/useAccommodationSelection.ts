import { useCallback, useState } from "react"
import type { SelectedAccommodationItem } from "@/types/checkout"

/**
 * The room the buyer has put in the cart.
 *
 * One room per checkout. Still stored as a list, and every entry is still
 * identified by (accommodation, check-in, check-out), because that is what
 * the cart, the persistence layer and the payment builder all speak; the
 * list simply never holds more than one. Picking a second room replaces the
 * first rather than adding to it, which is what makes the step a choice
 * instead of a shopping basket, and what keeps one stay from carrying two
 * sets of guest answers.
 *
 * A party that needs two rooms books twice. That is a worse experience than
 * a real multi-room cart and a much better one than the half-built version:
 * two rooms in one cart raise a pile of questions this checkout has no
 * answers for yet (which guests sleep where, one payment or two, what a
 * partial availability failure does at purchase time).
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
  const [accommodations, setStoredAccommodations] = useState<
    SelectedAccommodationItem[]
  >([])

  /**
   * Restore or clear the selection.
   *
   * Trimmed to one, not trusted as given: this is the door a persisted cart
   * comes back through, and a cart saved before the step went single-room
   * would otherwise restore two.
   */
  const setAccommodations = useCallback(
    (items: SelectedAccommodationItem[]) => {
      setStoredAccommodations(items.slice(0, 1))
    },
    [],
  )

  const addAccommodation = useCallback((item: SelectedAccommodationItem) => {
    setStoredAccommodations((prev) => {
      // Selecting the room already selected is a double-click. Keeping the
      // stored entry rather than the fresh one keeps the guest details
      // already typed into it.
      if (prev.length === 1 && entryKey(prev[0]) === entryKey(item)) return prev
      return [item]
    })
  }, [])

  const removeAccommodation = useCallback(
    (accommodationId: string, checkIn: string, checkOut: string) => {
      const key = entryKey({ accommodationId, checkIn, checkOut })
      setStoredAccommodations((prev) =>
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
      setStoredAccommodations((prev) =>
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
      setStoredAccommodations((prev) =>
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
