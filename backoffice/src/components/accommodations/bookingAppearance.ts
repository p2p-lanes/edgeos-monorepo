/**
 * How a booking looks, in one place.
 *
 * The calendar bar, the legend and the status badge in the bookings table all
 * answer the same question, "what kind of thing is occupying this room?",
 * and it is a question about *both* columns: `kind` says whether a human is
 * in the room, `status` whether the stay is paid for, and `payment_id`
 * whether it came from the checkout or from a staff member's phone call.
 *
 * Colours are hardcoded rather than themed: these bars sit on an arbitrary
 * background and must stay distinguishable from each other in both themes,
 * which semantic tokens do not guarantee.
 */

import type { CSSProperties } from "react"

import type { BookingKind, BookingStatus } from "@/client"

export type BookingAppearanceKey =
  | "confirmed"
  | "hold"
  | "manual"
  | "block"
  | "released"

interface BookingAppearance {
  label: string
  /** Bar / badge fill. */
  className: string
  /** Legend swatch: same fill, no text. */
  swatchClassName: string
  description: string
}

export const BOOKING_APPEARANCE: Record<
  BookingAppearanceKey,
  BookingAppearance
> = {
  confirmed: {
    label: "Confirmed",
    className:
      "bg-emerald-600 text-white border border-emerald-700 dark:bg-emerald-600 dark:border-emerald-400",
    swatchClassName: "bg-emerald-600 border border-emerald-700",
    description: "Paid through the checkout.",
  },
  hold: {
    label: "On hold",
    className:
      "bg-amber-500 text-white border border-amber-600 dark:bg-amber-500 dark:border-amber-400",
    swatchClassName: "bg-amber-500 border border-amber-600",
    description: "Reserved while a payment is in flight. Expires on its own.",
  },
  manual: {
    label: "Manual",
    className:
      "bg-sky-600 text-white border border-sky-700 dark:bg-sky-500 dark:border-sky-400",
    swatchClassName: "bg-sky-600 border border-sky-700",
    description: "Entered by staff: a comp, a phone booking, an organiser.",
  },
  block: {
    label: "Blocked",
    className:
      "bg-zinc-300 text-zinc-800 border border-dashed border-zinc-500 dark:bg-zinc-700 dark:text-zinc-100 dark:border-zinc-400",
    swatchClassName: "bg-zinc-300 border border-dashed border-zinc-500",
    description: "Off the market: maintenance, or held back on purpose.",
  },
  released: {
    label: "Released",
    className:
      "bg-muted text-muted-foreground border border-border line-through",
    swatchClassName: "bg-muted border border-border",
    description: "Cancelled or expired. The room is free again.",
  },
}

/**
 * A held stay is drawn with diagonal stripes on top of its fill: colour alone
 * separates it from a confirmed one, and this row is read at a glance by
 * someone deciding whether a room can be sold.
 */
export const HOLD_HATCH: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0 4px, transparent 4px 8px)",
}

/**
 * A night the room type is not on sale for: outside its bookable window, or
 * the whole type switched off.
 *
 * Grey plus a hatch rather than grey alone. The calendar already tints
 * weekends and today, and a closed night has to be unmistakable against both
 * without competing with the coloured bars laid over it.
 */
export const CLOSED_DAY: {
  label: string
  className: string
  swatchClassName: string
  description: string
} = {
  label: "Not bookable",
  className: "bg-zinc-400/25 dark:bg-zinc-500/25",
  swatchClassName: "bg-zinc-400/40 border border-zinc-500/40",
  description: "Outside the room's bookable window, or the room is off.",
}

export const CLOSED_DAY_HATCH: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(113,113,122,0.28) 0 4px, transparent 4px 8px)",
}

export function bookingAppearanceKey(booking: {
  kind?: BookingKind
  status?: BookingStatus
  payment_id?: string | null
}): BookingAppearanceKey {
  if (booking.status === "cancelled" || booking.status === "expired") {
    return "released"
  }
  if (booking.kind === "block" || booking.kind === "maintenance") {
    return "block"
  }
  if (booking.status === "hold") return "hold"
  return booking.payment_id ? "confirmed" : "manual"
}

export function bookingAppearance(booking: {
  kind?: BookingKind
  status?: BookingStatus
  payment_id?: string | null
}): BookingAppearance {
  return BOOKING_APPEARANCE[bookingAppearanceKey(booking)]
}

/** What to write inside the bar; blocks have no guest to name. */
export function bookingBarLabel(booking: {
  kind?: BookingKind
  primary_guest_name?: string | null
  notes?: string | null
}): string {
  if (booking.kind === "block" || booking.kind === "maintenance") {
    return booking.notes?.trim() || "Blocked"
  }
  return booking.primary_guest_name?.trim() || "Guest"
}
