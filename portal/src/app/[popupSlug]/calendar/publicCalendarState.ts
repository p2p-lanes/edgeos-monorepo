import { todayInTimezone } from "@/app/portal/[popupSlug]/events/lib/calendarDate"
import type { EventsView } from "@/app/portal/[popupSlug]/events/lib/toolbar/types"
import type { EventCalendarMeta, EventPublicCalendarItem } from "@/client"

export function parsePublicCalendarView(value: string | null): EventsView {
  return value === "calendar" || value === "day" ? value : "list"
}

/** Calendar-cell Dates use local fields, never an event's UTC instant. */
export function publicCalendarDefaultDate(
  meta: EventCalendarMeta,
  events: Pick<EventPublicCalendarItem, "start_time">[],
  now = new Date(),
): Date {
  const timezone = meta.timezone ?? "UTC"
  const today = todayInTimezone(timezone, now)
  const todayKey = localDayKey(today)
  const startKey = meta.popup_start_date?.slice(0, 10)
  const endKey = meta.popup_end_date?.slice(0, 10)
  const ended = meta.popup_ended || (!!endKey && todayKey > endKey)
  const upcoming = !!startKey && todayKey < startKey
  if ((!ended && !upcoming) || events.length === 0) return today

  const days = events.map((event) =>
    todayInTimezone(timezone, new Date(event.start_time)),
  )
  return days.reduce((chosen, day) =>
    ended
      ? day.getTime() > chosen.getTime()
        ? day
        : chosen
      : day.getTime() < chosen.getTime()
        ? day
        : chosen,
  )
}

export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
