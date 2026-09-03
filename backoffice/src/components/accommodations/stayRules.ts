/**
 * Whether a set of dates can be booked, and what to say when it cannot.
 *
 * This mirrors `check_stay_allowed` in `backend/app/api/accommodation/
 * availability.py`, in the same order, so the dialog and the API agree on
 * *why* something is refused. The server stays the authority: this exists so
 * an operator learns the answer while typing rather than after pressing a
 * button, and so the reason is a sentence instead of a 422.
 *
 * Availability is deliberately not checked here. Whether a unit is free needs
 * the database, and the server answers it with a 409 on submit.
 *
 * Dates are `YYYY-MM-DD` keys, half-open `[check_in, check_out)` as
 * everywhere else: `bookable_to` is a check-out bound, so a stay may *end* on
 * it, and the last night that can be sold is the day before.
 */

import { addDays, dayOffset, shortDay } from "./calendarLayout"

/** The default when neither the room nor the gathering sets one. */
export const DEFAULT_MIN_STAY_NIGHTS = 1

/** What a stay is checked against: the room type's own restrictions. */
export interface StayRules {
  name?: string
  bookable_from: string
  bookable_to: string
  is_active?: boolean
  guest_capacity?: number
  min_stay_override?: number | null
}

export interface Stay {
  checkIn: string
  checkOut: string
  guests?: number
}

/** Which control to point the operator at, so the message lands next to it. */
export type StayProblemField = "room" | "dates" | "guests"

export interface StayProblem {
  field: StayProblemField
  /** The headline: what is wrong. */
  title: string
  /** The fix, or the limit that was crossed. Always actionable. */
  detail: string
}

/** Room override, else the gathering's default, else one night. */
export function effectiveMinStay(
  room: Pick<StayRules, "min_stay_override">,
  popupMinStay?: number | null,
): number {
  return room.min_stay_override || popupMinStay || DEFAULT_MIN_STAY_NIGHTS
}

function nights(checkIn: string, checkOut: string): number {
  return dayOffset(checkOut, checkIn)
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

/**
 * The reason this stay cannot be booked, or `null` when it can.
 *
 * The order matches the backend's, which matters: a stay that is both outside
 * the window and too short should be reported the same way by both, or an
 * operator who fixes the reported problem gets a second, different refusal.
 */
export function checkStay(
  room: StayRules,
  stay: Stay,
  popupMinStay?: number | null,
): StayProblem | null {
  const label = room.name ?? "This room type"

  if (room.is_active === false) {
    return {
      field: "room",
      title: `${label} is switched off`,
      detail:
        "Turn it back on under Rooms, or pick another room type for this guest.",
    }
  }

  if (!stay.checkIn || !stay.checkOut || stay.checkOut <= stay.checkIn) {
    return {
      field: "dates",
      title: "Check-out must be after check-in",
      detail: "A stay covers at least one night.",
    }
  }

  if (stay.checkIn < room.bookable_from || stay.checkOut > room.bookable_to) {
    // Said in nights, because that is what is being sold. Quoting
    // `bookable_to` as the last day is the classic misreading: it is the
    // morning everyone leaves, not a night anyone sleeps.
    const lastNight = addDays(room.bookable_to, -1)
    return {
      field: "dates",
      title: "These dates are outside the booking window",
      detail: `${label} takes guests for the nights of ${shortDay(
        room.bookable_from,
      )} to ${shortDay(lastNight)}, with everyone out by ${shortDay(
        room.bookable_to,
      )}.`,
    }
  }

  const minStay = effectiveMinStay(room, popupMinStay)
  const booked = nights(stay.checkIn, stay.checkOut)
  if (booked < minStay) {
    return {
      field: "dates",
      title: `${label} has a ${minStay}-night minimum`,
      detail: `These dates cover ${plural(booked, "night")}. Move check-out to ${shortDay(
        addDays(stay.checkIn, minStay),
      )} or later.`,
    }
  }

  const capacity = room.guest_capacity ?? 1
  if (stay.guests !== undefined && stay.guests > capacity) {
    return {
      field: "guests",
      title: `${label} sleeps ${plural(capacity, "guest")}`,
      detail: `You entered ${stay.guests}. Book a second room, or a room type with more beds.`,
    }
  }

  return null
}
