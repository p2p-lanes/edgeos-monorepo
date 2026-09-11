import type {
  PublicAccommodation,
  PublicAccommodationAvailability,
} from "@/client"

/**
 * What the accommodation step may offer for a given stay.
 *
 * The step used to render every room and grey out the ones the server had
 * refused, with the reason printed inside the button that would have booked
 * them. This decides the other way round: a room the buyer cannot book is not
 * an offer, so it leaves the board, and what is left of it is a sentence
 * saying how to get it back.
 *
 * That sentence is the point. Removing options silently is worse than
 * greying them out, because the buyer is left comparing a shorter list with
 * no idea that a longer one existed. Every reason the backend gives except
 * "taken" and "not on sale" has a way back, and all of them are computable
 * from what the offer already carries: a minimum stay, a bookable window, a
 * capacity.
 */

export interface Stay {
  checkIn: string
  checkOut: string
  nights: number
  guests: number
}

export interface BoardEntry {
  room: PublicAccommodation
  availability: PublicAccommodationAvailability
  /** The backend's `REASON_*`, or null when the room can be booked. */
  reason: string | null
}

export interface Board {
  bookable: BoardEntry[]
  /**
   * Rooms the server refused, minus the ones that are not on sale at all.
   *
   * An inactive room is not an offer that fell through, it is not an offer,
   * so it is neither shown nor counted. Saying "1 room unavailable" about a
   * room the buyer could never have had is noise dressed as information.
   */
  blocked: BoardEntry[]
  /**
   * Rooms with no usable answer yet: the availability call has not landed,
   * or it came back without a reason *and* without a quote. Neither is
   * something to explain to a buyer, so they are counted separately and the
   * board shows its loading state instead of a wrong empty state.
   */
  unanswered: PublicAccommodation[]
}

export function buildBoard(
  rooms: PublicAccommodation[],
  availabilityById: Map<string, PublicAccommodationAvailability>,
): Board {
  const bookable: BoardEntry[] = []
  const blocked: BoardEntry[] = []
  const unanswered: PublicAccommodation[] = []

  for (const room of rooms) {
    const availability = availabilityById.get(room.id)
    if (!availability) {
      unanswered.push(room)
      continue
    }
    const reason = availability.unavailable_reason ?? null
    if (!reason) {
      // No reason and no quote is a server that did not answer, not a room
      // the buyer may have: selecting it would be selecting a stay at a
      // price nobody has given.
      if (availability.quote) bookable.push({ room, availability, reason })
      else unanswered.push(room)
      continue
    }
    if (reason !== "inactive") blocked.push({ room, availability, reason })
  }

  return { bookable, blocked, unanswered }
}

/**
 * The way back out of each kind of removal.
 *
 * Ordered by what the buyer can do about it: the two that a button can fix,
 * then the one a different party size fixes, then the dead end. "Taken" is
 * last and has no action, because finding the next free dates needs a search
 * the server does not offer yet.
 */
export type Recovery =
  | { kind: "extend_stay"; nights: number; rooms: number }
  | { kind: "opens_later"; date: string; rooms: number }
  | { kind: "closed_earlier"; date: string; rooms: number }
  | { kind: "party_too_big"; rooms: number; largest: number }
  | { kind: "taken"; rooms: number }

function minStayOf(room: PublicAccommodation): number {
  return Math.max(1, room.min_stay)
}

export function recoveriesFor(blocked: BoardEntry[], stay: Stay): Recovery[] {
  const out: Recovery[] = []

  const tooShort = blocked.filter(
    (entry) => entry.reason === "min_stay_not_met",
  )
  if (tooShort.length > 0) {
    // The smallest minimum among them: the nearest stay that opens anything,
    // not the longest one that opens everything.
    const nights = Math.min(...tooShort.map((entry) => minStayOf(entry.room)))
    out.push({
      kind: "extend_stay",
      nights,
      rooms: tooShort.filter((entry) => minStayOf(entry.room) === nights)
        .length,
    })
  }

  const offWindow = blocked.filter(
    (entry) => entry.reason === "outside_bookable_window",
  )
  const opening = offWindow.filter(
    (entry) => entry.room.bookable_from > stay.checkIn,
  )
  if (opening.length > 0) {
    const date = opening.reduce(
      (soonest, entry) =>
        entry.room.bookable_from < soonest ? entry.room.bookable_from : soonest,
      opening[0].room.bookable_from,
    )
    out.push({
      kind: "opens_later",
      date,
      rooms: opening.filter((entry) => entry.room.bookable_from === date)
        .length,
    })
  }
  // The other half of a window miss: the room was on sale and its last night
  // has passed. Told apart from the first because "opens on" and "closed on"
  // are opposite instructions.
  const closed = offWindow.filter(
    (entry) => entry.room.bookable_from <= stay.checkIn,
  )
  if (closed.length > 0) {
    const date = closed.reduce(
      (last, entry) =>
        entry.room.bookable_to > last ? entry.room.bookable_to : last,
      closed[0].room.bookable_to,
    )
    out.push({ kind: "closed_earlier", date, rooms: closed.length })
  }

  const tooSmall = blocked.filter((entry) => entry.reason === "over_capacity")
  if (tooSmall.length > 0) {
    out.push({
      kind: "party_too_big",
      rooms: tooSmall.length,
      largest: Math.max(...tooSmall.map((entry) => entry.room.guest_capacity)),
    })
  }

  const taken = blocked.filter((entry) => entry.reason === "sold_out")
  if (taken.length > 0) out.push({ kind: "taken", rooms: taken.length })

  return out
}

/** `YYYY-MM-DD` from a Date's local calendar parts. */
export function toDateInput(date: Date): string {
  // Local parts, not toISOString(): the picker hands back local midnights,
  // and their UTC rendering falls a day earlier east of UTC.
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function addDays(value: string, amount: number): string {
  const [year, month, day] = value.split("-").map(Number)
  return toDateInput(new Date(year, month - 1, day + amount))
}

/** The union of every room's bookable window: the outer bounds of the picker. */
export function bookableBounds(rooms: PublicAccommodation[]): {
  from: string | null
  to: string | null
} {
  if (rooms.length === 0) return { from: null, to: null }
  return {
    from: rooms.reduce(
      (min, room) => (room.bookable_from < min ? room.bookable_from : min),
      rooms[0].bookable_from,
    ),
    to: rooms.reduce(
      (max, room) => (room.bookable_to > max ? room.bookable_to : max),
      rooms[0].bookable_to,
    ),
  }
}

/**
 * The largest party any room here could take.
 *
 * The ceiling on the guest stepper. Without it the buyer can ask for eight
 * people in a house that sleeps six and be shown an empty board with no
 * indication that the number itself was the problem.
 */
export function largestParty(rooms: PublicAccommodation[]): number {
  return rooms.reduce((max, room) => Math.max(max, room.guest_capacity), 1)
}
