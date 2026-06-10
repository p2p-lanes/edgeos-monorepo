/**
 * Pure block-positioning math shared by the day-view venue calendars.
 *
 * Extracted from `VenueDayCalendar.tsx` so the single-venue schedule
 * preview in the event form (`forms/EventForm/VenueDaySchedule.tsx`) can
 * reuse the exact same layout rules instead of duplicating them.
 */

export const HOUR_HEIGHT = 44
export const DAY_MINUTES = 24 * 60

/**
 * Resolve an ISO instant into the calendar day + minute-of-day it falls on
 * in the given timezone. Returns null on an unparseable input.
 */
export function toLocalDayMinutes(
  iso: string,
  tz: string,
): { dayKey: string; minutes: number } | null {
  try {
    const d = new Date(iso)
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d)
    const get = (t: string) =>
      Number(parts.find((p) => p.type === t)?.value ?? "0")
    const dayKey = `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`
    const minutes = get("hour") * 60 + get("minute")
    return { dayKey, minutes }
  } catch {
    return null
  }
}

export type PositionedBlock = {
  key: string
  dayKey: string
  top: number
  height: number
  label: string
  source: "event" | "exception" | string
  eventId?: string | null
  setupMinutes?: number
  teardownMinutes?: number
  highlighted?: boolean
  // Mirrors `VenueBusySlot.visibility` ("public" | "private" | "unlisted")
  // so consumers can flag non-public blocks. Undefined for non-event slots.
  visibility?: string | null
}

export function slotToBlocks(
  slot: {
    start: string
    end: string
    source: string
    label?: string | null
    event_id?: string | null
    event_start?: string | null
    event_end?: string | null
    highlighted?: boolean
    visibility?: string | null
  },
  tz: string,
  idx: number,
): PositionedBlock[] {
  const start = toLocalDayMinutes(slot.start, tz)
  const end = toLocalDayMinutes(slot.end, tz)
  if (!start || !end) return []

  let setupMinutes = 0
  let teardownMinutes = 0
  if (slot.event_start && slot.event_end) {
    const evStart = new Date(slot.event_start).getTime()
    const evEnd = new Date(slot.event_end).getTime()
    const blockStart = new Date(slot.start).getTime()
    const blockEnd = new Date(slot.end).getTime()
    setupMinutes = Math.max(0, Math.round((evStart - blockStart) / 60000))
    teardownMinutes = Math.max(0, Math.round((blockEnd - evEnd) / 60000))
  }

  const sameDay = start.dayKey === end.dayKey
  if (sameDay) {
    return [
      {
        key: `${slot.source}-${idx}`,
        dayKey: start.dayKey,
        top: (start.minutes / 60) * HOUR_HEIGHT,
        height: Math.max(
          ((end.minutes - start.minutes) / 60) * HOUR_HEIGHT,
          HOUR_HEIGHT / 4,
        ),
        label: slot.label ?? "",
        source: slot.source,
        eventId: slot.event_id ?? null,
        setupMinutes,
        teardownMinutes,
        highlighted: slot.highlighted ?? false,
        visibility: slot.visibility ?? null,
      },
    ]
  }

  return [
    {
      key: `${slot.source}-${idx}-a`,
      dayKey: start.dayKey,
      top: (start.minutes / 60) * HOUR_HEIGHT,
      height: ((DAY_MINUTES - start.minutes) / 60) * HOUR_HEIGHT,
      label: slot.label ?? "",
      source: slot.source,
      eventId: slot.event_id ?? null,
      highlighted: slot.highlighted ?? false,
      visibility: slot.visibility ?? null,
    },
    {
      key: `${slot.source}-${idx}-b`,
      dayKey: end.dayKey,
      top: 0,
      height: (end.minutes / 60) * HOUR_HEIGHT,
      label: slot.label ?? "",
      source: slot.source,
      eventId: slot.event_id ?? null,
      highlighted: slot.highlighted ?? false,
      visibility: slot.visibility ?? null,
    },
  ]
}

/**
 * Closed bands = complement of open ranges within a full 24h day.
 * Mirrors the helper in VenueWeekCalendar so both calendars apply the
 * same rule.
 */
export function computeClosedBlocks(
  openBlocks: PositionedBlock[],
  dayKey: string,
): PositionedBlock[] {
  const dayHeight = 24 * HOUR_HEIGHT
  const sorted = [...openBlocks].sort((a, b) => a.top - b.top)
  const closed: PositionedBlock[] = []
  let cursor = 0
  let i = 0
  for (const o of sorted) {
    if (o.top > cursor) {
      closed.push({
        key: `closed-${dayKey}-${i++}`,
        dayKey,
        top: cursor,
        height: o.top - cursor,
        label: "",
        source: "closed",
      })
    }
    cursor = Math.max(cursor, o.top + o.height)
  }
  if (cursor < dayHeight) {
    closed.push({
      key: `closed-${dayKey}-${i++}`,
      dayKey,
      top: cursor,
      height: dayHeight - cursor,
      label: "",
      source: "closed",
    })
  }
  return closed
}
