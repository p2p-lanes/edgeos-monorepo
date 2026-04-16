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

      <div className="rounded-lg border-2 border-border bg-card overflow-hidden">
        {/*
          Single scroll container so the header and day columns stay
          aligned regardless of vertical-scrollbar width (that was the
          source of the 1-2px misalignment when the header and body
          were separate grids).
        */}
        <div className="max-h-[720px] overflow-y-auto">
          <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))]">
            {/* Sticky header row */}
            <div className="sticky top-0 z-10 bg-muted border-b-2 border-r border-border h-12" />
            {days.map((d, i) => (
              <div
                key={d.key}
                className={cn(
                  "sticky top-0 z-10 bg-muted border-b-2 border-border h-12 flex flex-col items-center justify-center gap-0.5",
                  i < 6 && "border-r",
                  d.isToday && "bg-primary/10",
                )}
              >
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {d.date.toLocaleDateString("en-US", {
                    weekday: "short",
                    timeZone: "UTC",
                  })}
                </span>
                <span
                  className={cn(
                    "text-sm font-semibold leading-none",
                    d.isToday ? "text-primary" : "text-foreground",
                  )}
                >
                  {d.date.toLocaleDateString("en-US", {
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </span>
              </div>
            ))}

            {/* Hour labels column */}
            <div className="border-r border-border">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  style={{ height: HOUR_HEIGHT }}
                  className="flex items-start justify-end pr-2 pt-0.5 text-[11px] font-medium text-muted-foreground border-t border-border first:border-t-0"
                >
                  {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {days.map((d, i) => {
              const dayOpen = openByDay[d.key] ?? []
              const dayBusy = busyByDay[d.key] ?? []
              return (
                <div
                  key={d.key}
                  className={cn(
                    "relative",
                    i < 6 && "border-r border-border",
                    d.isToday && "bg-primary/[0.03]",
                  )}
                  style={{ height: HOUR_HEIGHT * 24 }}
                >
                  {/* Hour grid lines — strong enough to see but not noisy */}
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={h}
                      style={{ top: h * HOUR_HEIGHT }}
                      className="absolute left-0 right-0 border-t border-border"
                    />
                  ))}

                  {/* Open range band — visible green tint for "when the venue is open" */}
                  {dayOpen.map((o) => (
                    <div
                      key={o.key}
                      style={{ top: o.top, height: o.height }}
                      className="absolute left-0 right-0 bg-emerald-500/10"
                    />
                  ))}

                  {/* Busy blocks: events + closed exceptions.
                      We use fixed sky/zinc palette (not theme tokens) so
                      contrast stays punchy in both light and dark modes —
                      the tenant's `primary` can be an arbitrarily dark
                      brand colour which reads invisible against a dark
                      calendar surface. */}
                  {dayBusy.map((b) => {
                    const isClosedException = b.source === "exception"
                    return (
                      <div
                        key={b.key}
                        style={{ top: b.top + 1, height: b.height - 2 }}
                        title={b.label}
                        className={cn(
                          "absolute left-1 right-1 rounded-md px-1.5 py-1 text-[11px] font-medium leading-tight overflow-hidden shadow-sm",
                          isClosedException
                            ? "bg-zinc-300 text-zinc-800 border border-zinc-500 border-dashed dark:bg-zinc-700 dark:text-zinc-100 dark:border-zinc-400"
                            : "bg-sky-600 text-white border border-sky-700 dark:bg-sky-500 dark:text-white dark:border-sky-400",
                        )}
                      >
                        <div className="truncate">{b.label}</div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-sky-600 dark:bg-sky-500" />
          Event
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-emerald-500/30" />
          Open hours
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-zinc-300 border border-dashed border-zinc-500 dark:bg-zinc-700 dark:border-zinc-400" />
          Closed exception
        </div>
      </div>
    </div>
  )
}
