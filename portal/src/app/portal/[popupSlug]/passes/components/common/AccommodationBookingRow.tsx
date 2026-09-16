"use client"

import { BedDouble } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TicketEntry } from "@/types/Attendee"
import { formatCheckoutDate, formatCurrency } from "@/types/checkout"
import { parseBooking } from "../../utils/accommodationBooking"

/**
 * A booked stay on the passes page.
 *
 * Rooms arrive here as ordinary purchased tickets, so without this they would
 * render as a bare product name, and "Double Room" with no dates is the one
 * thing a guest cannot use. Everything shown is read from the frozen
 * `purchase_metadata`; nothing is fetched.
 *
 * There is no QR: a room is not checked in at a gate, it is a name at a front
 * desk, which is why the guest list matters more than a code here.
 */
export function AccommodationBookingRow({ entry }: { entry: TicketEntry }) {
  const { t } = useTranslation()
  const booking = parseBooking(entry)
  if (!booking) return null

  const guestLine =
    booking.guests.length > 0
      ? booking.guests.join(", ")
      : booking.guestCount
        ? t("checkout.accommodation.guests", { count: booking.guestCount })
        : null

  return (
    <div className="flex items-start gap-2 py-3">
      <BedDouble className="mt-0.5 h-4 w-4 flex-shrink-0 text-pass-text lg:h-5 lg:w-5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-bold text-pass-title lg:text-base">
            {booking.accommodationName ?? entry.product_name}
          </span>
          {booking.unitLabel && (
            <span className="text-xs text-pass-text">{booking.unitLabel}</span>
          )}
        </div>

        <p className="text-xs text-pass-text">
          {booking.propertyName ? `${booking.propertyName} · ` : ""}
          {formatCheckoutDate(booking.checkIn)} →{" "}
          {formatCheckoutDate(booking.checkOut)}
          {booking.nights
            ? ` · ${t("checkout.accommodation.nights", { count: booking.nights })}`
            : ""}
        </p>

        {guestLine && <p className="text-xs text-pass-text">{guestLine}</p>}

        {booking.propertyAddress && (
          <p className="text-xs text-pass-text opacity-80">
            {booking.propertyAddress}
          </p>
        )}
      </div>

      {booking.total && (
        <span className="flex-shrink-0 text-sm font-medium text-pass-title">
          {formatCurrency(Number(booking.total), booking.currency ?? undefined)}
        </span>
      )}
    </div>
  )
}
