import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { useMemo, useState } from "react"

import {
  EventVenuesService,
  type VenueBusySlot,
  type VenueOpenRange,
} from "@/client"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Week-grid calendar for a single venue.
 *
 * Seven day columns × hourly rows, absolutely-positioned blocks for every
 * busy slot returned by ``/event-venues/{id}/availability``. Open ranges
 * are rendered as a soft "available" band behind the blocks so the user
 * can tell at a glance when the venue is open vs. just idle.
 *
 * All computations happen in the popup's configured timezone — the API
 * returns UTC, we convert to local-TZ minutes-of-week for positioning.
 *
 * Events rendered here don't link back to their edit page yet: the
 * availability response only carries title + timing, not event id.
 * Add ``event_id`` to ``VenueBusySlot`` backend-side if click-through
 * becomes valuable.
 */

const HOUR_HEIGHT = 44 // px per hour — ~17 min visible before scroll
const DAY_MINUTES = 24 * 60

type DayColumn = {
  date: Date // midnight in the venue's TZ, represented as naive local
  key: string // YYYY-MM-DD
  label: string // e.g. "Mon 5"
  isToday: boolean
}

function tzToday(tz: string): Date {
  const now = new Date()
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? "0")
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")))
}

function startOfWeek(d: Date): Date {
  // Monday = 0.
  const day = (d.getUTCDay() + 6) % 7
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day),
  )
}

function addDays(d: Date, n: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n),
  )
}

function buildWeek(weekStart: Date, todayInTz: Date): DayColumn[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i)
    const key = date.toISOString().slice(0, 10)
    return {
      date,
      key,
      label: date.toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        timeZone: "UTC", // the `date` itself is UTC-midnight of a local day
      }),
      isToday: key === todayInTz.toISOString().slice(0, 10),
    }
  })
}

/**
 * Convert an ISO instant to {dayKey, minutesFromMidnight} in the given
 * timezone. Returns null if the formatter can't resolve the timezone.
 */
function toLocalDayMinutes(
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

type PositionedBlock = {
  key: string
  dayKey: string
  top: number
  height: number
  label: string
  source: "event" | "exception" | string
}

/**
 * Split a time range across midnight boundaries so multi-day entries
 * render as one block per day. Assumes end > start.
 */
function slotToBlocks(
  slot: { start: string; end: string; source: string; label?: string | null },
  tz: string,
  idx: number,
): PositionedBlock[] {
  const start = toLocalDayMinutes(slot.start, tz)
  const end = toLocalDayMinutes(slot.end, tz)
  if (!start || !end) return []

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
      },
    ]
  }

  // Spans midnight: emit the day-of-start clipped to 24:00, then the
  // day-of-end clipped to 0:00 → end. We ignore any full-day middle
  // slices since calendar events that long are rare in this app; if
  // that assumption breaks, expand here.
  return [
    {
      key: `${slot.source}-${idx}-a`,
      dayKey: start.dayKey,
      top: (start.minutes / 60) * HOUR_HEIGHT,
      height: ((DAY_MINUTES - start.minutes) / 60) * HOUR_HEIGHT,
      label: slot.label ?? "",
      source: slot.source,
    },
    {
      key: `${slot.source}-${idx}-b`,
      dayKey: end.dayKey,
      top: 0,
      height: (end.minutes / 60) * HOUR_HEIGHT,
      label: slot.label ?? "",
      source: slot.source,
    },
  ]
}

function groupByDay(
  blocks: PositionedBlock[],
): Record<string, PositionedBlock[]> {
  const map: Record<string, PositionedBlock[]> = {}
  for (const b of blocks) {
    const bucket = map[b.dayKey]
    if (bucket) bucket.push(b)
    else map[b.dayKey] = [b]
  }
  return map
}

function formatHeaderTz(date: Date): string {
  // date is UTC-midnight representing a local day; format from parts to
  // avoid a timezone conversion muddling the visible label.
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

export function VenueWeekCalendar({
  venueId,
  timezone,
}: {
  venueId: string
  timezone: string
}) {
  const [weekAnchor, setWeekAnchor] = useState<Date>(() =>
    startOfWeek(tzToday(timezone)),
  )
  const todayInTz = useMemo(() => tzToday(timezone), [timezone])
  const days = useMemo(
    () => buildWeek(weekAnchor, todayInTz),
    [weekAnchor, todayInTz],
  )

  // The availability endpoint wants a UTC instant range. Interpret each
  // day's midnight as local (in ``timezone``) and convert to UTC for the
  // query. The backend applies timezone math internally; we just bracket
  // the window.
  const { rangeStartUtc, rangeEndUtc } = useMemo(() => {
    const firstDayKey = days[0].key
    const lastDayKey = days[6].key
    // Build an ISO using the local day + T00:00 then convert through
    // the target timezone. The backend re-interprets in the popup TZ
    // anyway; we just need a wide enough UTC bracket.
    const startLocal = new Date(`${firstDayKey}T00:00:00.000Z`)
    const endLocal = new Date(`${lastDayKey}T23:59:59.999Z`)
    return {
      rangeStartUtc: startLocal.toISOString(),
      rangeEndUtc: endLocal.toISOString(),
    }
  }, [days])

  const { data, isLoading } = useQuery({
    queryKey: [
      "venue-availability",
      venueId,
      rangeStartUtc,
      rangeEndUtc,
      timezone,
    ],
    queryFn: () =>
      EventVenuesService.getAvailability({
        venueId,
        start: rangeStartUtc,
        end: rangeEndUtc,
      }),
    enabled: !!venueId,
    staleTime: 30 * 1000,
  })

  const busy = data?.busy ?? []
  const open = data?.open_ranges ?? []

  const busyBlocks = useMemo(
    () =>
      (busy as VenueBusySlot[]).flatMap((s, i) => slotToBlocks(s, timezone, i)),
    [busy, timezone],
  )
  const openBlocks = useMemo(
    () =>
      (open as VenueOpenRange[]).flatMap((s, i) =>
        slotToBlocks(
          { start: s.start, end: s.end, source: "open", label: null },
          timezone,
          i,
        ),
      ),
    [open, timezone],
  )

  const busyByDay = useMemo(() => groupByDay(busyBlocks), [busyBlocks])
  const openByDay = useMemo(() => groupByDay(openBlocks), [openBlocks])

  const weekLabel = `${formatHeaderTz(days[0].date)} – ${formatHeaderTz(days[6].date)}`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekAnchor((d) => addDays(d, -7))}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekAnchor(startOfWeek(todayInTz))}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekAnchor((d) => addDays(d, 7))}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-sm text-muted-foreground">
          {weekLabel}
          <span className="ml-2 text-xs">({timezone})</span>
          {isLoading && (
            <Loader2 className="inline ml-2 h-3 w-3 animate-spin align-middle" />
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b bg-muted/30">
          <div className="border-r" />
          {days.map((d) => (
            <div
              key={d.key}
              className={cn(
                "px-2 py-2 text-center text-xs font-medium border-r last:border-r-0",
                d.isToday && "text-primary",
              )}
            >
              {d.label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] max-h-[720px] overflow-y-auto">
          {/* Hour labels column */}
          <div className="border-r">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                style={{ height: HOUR_HEIGHT }}
                className="flex items-start justify-end pr-2 pt-0.5 text-[10px] text-muted-foreground border-t first:border-t-0"
              >
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          {days.map((d) => {
            const dayOpen = openByDay[d.key] ?? []
            const dayBusy = busyByDay[d.key] ?? []
            return (
              <div
                key={d.key}
                className="relative border-r last:border-r-0"
                style={{ height: HOUR_HEIGHT * 24 }}
              >
                {/* Hour grid lines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    style={{ top: h * HOUR_HEIGHT }}
                    className="absolute left-0 right-0 border-t border-border/40"
                  />
                ))}

                {/* Open range band (subtle, behind busy) */}
                {dayOpen.map((o) => (
                  <div
                    key={o.key}
                    style={{ top: o.top, height: o.height }}
                    className="absolute left-0 right-0 bg-green-500/5"
                  />
                ))}

                {/* Busy blocks: events + closed exceptions */}
                {dayBusy.map((b) => {
                  const isClosedException = b.source === "exception"
                  return (
                    <div
                      key={b.key}
                      style={{ top: b.top + 1, height: b.height - 2 }}
                      title={b.label}
                      className={cn(
                        "absolute left-1 right-1 rounded-md px-1.5 py-1 text-[11px] leading-tight overflow-hidden",
                        isClosedException
                          ? "bg-muted text-muted-foreground border border-dashed"
                          : "bg-primary/15 text-primary border border-primary/30",
                      )}
                    >
                      <div className="truncate font-medium">{b.label}</div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
