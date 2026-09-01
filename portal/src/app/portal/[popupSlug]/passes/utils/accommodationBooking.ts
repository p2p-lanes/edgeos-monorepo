import type { TicketEntry } from "@/types/Attendee"

/**
 * Reading a booked stay off a purchased ticket.
 *
 * A room reaches the passes page as an ordinary `AttendeeProductPublic` whose
 * `purchase_metadata` carries the stay. Everything shown here is frozen in
 * that blob at purchase time on purpose: it is the guest's receipt, and it
 * has to keep saying what they booked even after the property is renamed or
 * the room type is retired.
 */

export const ACCOMMODATION_METADATA_KIND = "accommodation_booking"

export interface BookingSummary {
  bookingId: string | null
  accommodationName: string | null
  propertyName: string | null
  propertyAddress: string | null
  unitLabel: string | null
  checkIn: string
  checkOut: string
  nights: number | null
  guestCount: number | null
  guests: string[]
  total: string | null
  currency: string | null
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function isAccommodationEntry(entry: TicketEntry): boolean {
  const metadata = entry.purchase_metadata
  return !!metadata && metadata.kind === ACCOMMODATION_METADATA_KIND
}

/**
 * Parse the stay, or return null when the blob is not one.
 *
 * Missing dates fail the whole parse rather than rendering "→" with nothing
 * around it: a booking card with no stay on it is worse than no card.
 */
export function parseBooking(entry: TicketEntry): BookingSummary | null {
  const metadata = entry.purchase_metadata
  if (!metadata || metadata.kind !== ACCOMMODATION_METADATA_KIND) return null

  const checkIn = str(metadata.check_in)
  const checkOut = str(metadata.check_out)
  if (!checkIn || !checkOut) return null

  const quote = (metadata.quote ?? null) as Record<string, unknown> | null
  const rawGuests = Array.isArray(metadata.guests) ? metadata.guests : []

  return {
    bookingId: str(metadata.booking_id),
    // `product_name` is the live room name; the frozen one wins when present.
    accommodationName:
      str(metadata.accommodation_name) ?? str(entry.product_name),
    propertyName: str(metadata.property_name),
    propertyAddress: str(metadata.property_address),
    unitLabel: str(metadata.unit_label),
    checkIn,
    checkOut,
    nights: num(metadata.nights),
    guestCount: num(metadata.guest_count),
    guests: rawGuests
      .map((guest) =>
        guest && typeof guest === "object"
          ? str((guest as Record<string, unknown>).name)
          : null,
      )
      .filter((name): name is string => !!name),
    total: quote ? str(quote.total) : null,
    currency: quote ? str(quote.currency) : null,
  }
}
