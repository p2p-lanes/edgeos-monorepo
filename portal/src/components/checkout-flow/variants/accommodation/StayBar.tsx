"use client"

/**
 * The stay: two dates and a party size, above the rooms they filter.
 *
 * Party size sits here rather than next to each room's guest names because
 * it decides *which rooms exist* for this buyer. Asked afterwards, a party of
 * six can pick a room that sleeps two and only find out at the guest form; the
 * availability endpoint has always taken a guest count and the step simply
 * never sent one.
 *
 * The room count is the receipt for all three controls. It is a live region:
 * rooms leaving the board when a date moves is the whole behaviour of this
 * step, and it is invisible to a screen reader unless something says it.
 */

import { Loader2, Minus, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import { addDays, toDateInput } from "@/lib/accommodationBoard"

interface StayBarProps {
  checkIn: string
  checkOut: string
  guests: number
  /** The capacity of the largest room on offer: asking for more finds nothing. */
  maxGuests: number
  bounds: { from: string | null; to: string | null }
  roomCount: number
  loading: boolean
  onStayChange: (checkIn: string, checkOut: string) => void
  onGuestsChange: (guests: number) => void
}

export function StayBar({
  checkIn,
  checkOut,
  guests,
  maxGuests,
  bounds,
  roomCount,
  loading,
  onStayChange,
  onGuestsChange,
}: StayBarProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stay-check-in">
            {t("checkout.accommodation.check_in")}
          </Label>
          <DatePicker
            id="stay-check-in"
            value={checkIn}
            onChange={(value) =>
              onStayChange(
                value,
                // Never leave check-out on or before the new check-in: the
                // server would refuse the range and the board would empty
                // for a reason the buyer did not cause.
                checkOut && checkOut > value ? checkOut : addDays(value, 1),
              )
            }
            disabledDays={(day) => {
              const key = toDateInput(day)
              return (
                (!!bounds.from && key < bounds.from) ||
                (!!bounds.to && key >= bounds.to)
              )
            }}
            defaultMonth={bounds.from ? new Date(bounds.from) : undefined}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stay-check-out">
            {t("checkout.accommodation.check_out")}
          </Label>
          <DatePicker
            id="stay-check-out"
            value={checkOut}
            onChange={(value) => onStayChange(checkIn, value)}
            disabledDays={(day) => {
              const key = toDateInput(day)
              return (
                (!!checkIn && key <= checkIn) ||
                (!!bounds.to && key > bounds.to)
              )
            }}
            defaultMonth={checkIn ? new Date(checkIn) : undefined}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stay-guests">
            {t("checkout.accommodation.guests_label")}
          </Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("checkout.accommodation.stay.fewer_guests")}
              disabled={guests <= 1}
              onClick={() => onGuestsChange(guests - 1)}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <output
              id="stay-guests"
              className="w-10 text-center text-sm font-medium tabular-nums"
            >
              {guests}
            </output>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("checkout.accommodation.stay.more_guests")}
              disabled={guests >= maxGuests}
              onClick={() => onGuestsChange(guests + 1)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <p
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        {loading ? (
          <>
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
            {t("checkout.accommodation.stay.checking")}
          </>
        ) : (
          t("checkout.accommodation.stay.results", { count: roomCount })
        )}
      </p>
    </div>
  )
}
