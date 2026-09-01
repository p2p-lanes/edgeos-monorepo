/**
 * Pure geometry for the booking calendar.
 *
 * Split out of `BookingCalendar.tsx` for the same reason `venueDayLayout`
 * is split out of the venue calendars: the bar math is where the bugs live
 * (off-by-one nights, stays that start before the visible month, two guests
 * sharing a turnover day) and it is worth testing without a DOM.
 *
 * Dates are half-open `[check_in, check_out)` everywhere, matching the
 * backend, and handled as `YYYY-MM-DD` keys in UTC so a browser in
 * Argentina and one in Berlin draw the same month.
 */

import type { CalendarBooking } from "@/client"

export const DAY_WIDTH = 40
export const HALF_DAY = DAY_WIDTH / 2
/** Room-type and unit rows; the property header row is taller. */
export const ROW_HEIGHT = 32
export const LABEL_WIDTH = 240

export function parseDay(key: string): Date {
  const [year, month, day] = key.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(key: string, amount: number): string {
  const date = parseDay(key)
  date.setUTCDate(date.getUTCDate() + amount)
  return toDayKey(date)
}

/** Whole days from `from` to `key`; negative when `key` is earlier. */
export function dayOffset(key: string, from: string): number {
  const millis = parseDay(key).getTime() - parseDay(from).getTime()
  return Math.round(millis / 86_400_000)
}

/** The visible columns of `[from, to)`; `to` itself is not a column. */
export function eachDay(from: string, to: string): string[] {
  const total = dayOffset(to, from)
  if (total <= 0) return []
  return Array.from({ length: total }, (_, index) => addDays(from, index))
}

/**
 * The nights a room type is not on sale for, out of the visible columns.
 *
 * `bookable_to` is a check-out bound, so the last night that can be sold is
 * the day before it: half-open here as everywhere else. A room type that is
 * switched off is closed on every night, whatever its window says.
 *
 * Keys are `YYYY-MM-DD`, which compare correctly as strings, so this needs no
 * date parsing.
 */
export function closedDays(
  days: string[],
  window: { bookable_from: string; bookable_to: string; is_active?: boolean },
): Set<string> {
  if (window.is_active === false) return new Set(days)
  return new Set(
    days.filter(
      (day) => day < window.bookable_from || day >= window.bookable_to,
    ),
  )
}

export function isWeekend(key: string): boolean {
  const weekday = parseDay(key).getUTCDay()
  return weekday === 0 || weekday === 6
}

export function monthLabel(key: string): string {
  return parseDay(key).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function dayNumber(key: string): string {
  return String(parseDay(key).getUTCDate())
}

/** "Jun 1": compact enough for a tooltip or a label cell. */
export function shortDay(key: string): string {
  return parseDay(key).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

export function weekdayInitial(key: string): string {
  return parseDay(key)
    .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
    .slice(0, 1)
}

/** First day of the month `key` falls in, and the first day of the next. */
export function monthWindow(key: string): { from: string; to: string } {
  const date = parseDay(key)
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const to = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  )
  return { from: toDayKey(from), to: toDayKey(to) }
}

export function shiftMonth(key: string, amount: number): string {
  const date = parseDay(key)
  return toDayKey(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1)),
  )
}

export function todayKey(): string {
  return toDayKey(new Date())
}

export interface BookingBar {
  booking: CalendarBooking
  left: number
  width: number
  /** The stay began before the window, so draw a flat rather than pointed edge. */
  openStart: boolean
  openEnd: boolean
}

/**
 * Position one stay on a unit row.
 *
 * The half-day offsets are the whole trick: a stay starts at the *middle* of
 * its check-in column and ends at the middle of its check-out column, so the
 * guest leaving on the 5th and the guest arriving on the 5th each own half of
 * that cell instead of fighting over it.
 */
export function layoutBooking(
  booking: CalendarBooking,
  from: string,
  to: string,
): BookingBar | null {
  const totalDays = dayOffset(to, from)
  if (totalDays <= 0) return null

  const rawLeft = dayOffset(booking.check_in, from) * DAY_WIDTH + HALF_DAY
  const rawRight = dayOffset(booking.check_out, from) * DAY_WIDTH + HALF_DAY
  const limit = totalDays * DAY_WIDTH

  const left = Math.max(rawLeft, 0)
  const right = Math.min(rawRight, limit)
  if (right <= left) return null

  return {
    booking,
    left,
    width: right - left,
    openStart: rawLeft < 0,
    openEnd: rawRight > limit,
  }
}

/**
 * Bars for one unit row. The exclusion constraint guarantees no two blocking
 * stays overlap on a unit, so a single lane is always enough: anything that
 * looks stacked here would be a database bug, not a layout one.
 */
export function layoutBookings(
  bookings: CalendarBooking[],
  from: string,
  to: string,
): BookingBar[] {
  return bookings
    .map((booking) => layoutBooking(booking, from, to))
    .filter((bar): bar is BookingBar => bar !== null)
    .sort((a, b) => a.left - b.left)
}
