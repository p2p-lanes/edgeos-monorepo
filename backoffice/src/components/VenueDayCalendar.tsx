import { tzOffsetMinutes } from "@edgeos/shared-events"
import { useQueries } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import type * as React from "react"
import { useMemo, useState } from "react"

import {
  EventVenuesService,
  type VenueBusySlot,
  type VenueOpenRange,
} from "@/client"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Single-day, multi-venue grid. Mirrors `VenueWeekCalendar` visually but
 * swaps axes: each column is a venue, rows are hours of the selected day.
 * Useful for eyeballing venue availability side-by-side when scheduling
 * or approving events.
 *
 * Horizontal scroll kicks in when venue count × column width exceeds the
 * viewport; the hour-labels column stays sticky on the left.
 */

const HOUR_HEIGHT = 44
const DAY_MINUTES = 24 * 60
const VENUE_COL_MIN = 160 // px — keeps names readable; below this cols feel squashed

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

function addDays(d: Date, n: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n),
  )
}

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
  eventId?: string | null
  setupMinutes?: number
  teardownMinutes?: number
}

function slotToBlocks(
  slot: {
    start: string
    end: string
    source: string
    label?: string | null
    event_id?: string | null
    event_start?: string | null
    event_end?: string | null
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

/**
 * Closed bands = complement of open ranges within a full 24h day.
 * Mirrors the helper in VenueWeekCalendar so both calendars apply the
 * same rule.
 */
function computeClosedBlocks(
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

function formatDayHeader(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

export type DayCalendarVenue = {
  id: string
  title: string
}

export function VenueDayCalendar({
  venues,
  timezone,
  onCreateAt,
  onEventClick,
  onExceptionClick,
}: {
  venues: DayCalendarVenue[]
  timezone: string
  onCreateAt?: (venueId: string, startIso: string) => void
  onEventClick?: (eventId: string) => void
  onExceptionClick?: (reason: string | null) => void
}) {
  const [dayAnchor, setDayAnchor] = useState<Date>(() => tzToday(timezone))
  const todayInTz = useMemo(() => tzToday(timezone), [timezone])
  const dayKey = dayAnchor.toISOString().slice(0, 10)
  const todayKey = todayInTz.toISOString().slice(0, 10)
  const isToday = dayKey === todayKey

  // Bracket the day in UTC; backend re-interprets in the popup TZ. Pad by
  // 24h on each side so events that cross midnight in the local TZ are
  // still returned (a 23:00→01:00 event starts the *previous* UTC day in
  // east-of-UTC zones).
  const { rangeStartUtc, rangeEndUtc } = useMemo(() => {
    const prev = addDays(dayAnchor, -1).toISOString().slice(0, 10)
    const next = addDays(dayAnchor, 1).toISOString().slice(0, 10)
    return {
      rangeStartUtc: `${prev}T00:00:00.000Z`,
      rangeEndUtc: `${next}T23:59:59.999Z`,
    }
  }, [dayAnchor])

  const queries = useQueries({
    queries: venues.map((v) => ({
      queryKey: [
        "venue-availability",
        v.id,
        rangeStartUtc,
        rangeEndUtc,
        timezone,
      ],
      queryFn: () =>
        EventVenuesService.getAvailability({
          venueId: v.id,
          start: rangeStartUtc,
          end: rangeEndUtc,
        }),
      enabled: !!v.id,
      staleTime: 30 * 1000,
    })),
  })

  const isLoading = queries.some((q) => q.isLoading)

  const perVenue = venues.map((v, idx) => {
    const res = queries[idx]?.data
    const busy = (res?.busy ?? []) as VenueBusySlot[]
    const open = (res?.open_ranges ?? []) as VenueOpenRange[]
    const busyBlocks = busy
      .flatMap((s, i) => slotToBlocks(s, timezone, i))
      .filter((b) => b.dayKey === dayKey)
    const openBlocks = open
      .flatMap((s, i) =>
        slotToBlocks(
          { start: s.start, end: s.end, source: "open", label: null },
          timezone,
          i,
        ),
      )
      .filter((b) => b.dayKey === dayKey)
    return { venue: v, busyBlocks, openBlocks }
  })

  const venueCount = venues.length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDayAnchor((d) => addDays(d, -1))}
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDayAnchor(tzToday(timezone))}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDayAnchor((d) => addDays(d, 1))}
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-sm text-muted-foreground">
          <span className={cn(isToday && "font-medium text-primary")}>
            {formatDayHeader(dayAnchor)}
          </span>
          <span className="ml-2 text-xs">({timezone})</span>
          {isLoading && (
            <Loader2 className="inline ml-2 h-3 w-3 animate-spin align-middle" />
          )}
        </div>
      </div>

      {venueCount === 0 ? (
        <div className="rounded-lg border-2 border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No venues to display. Create a venue to see its availability here.
        </div>
      ) : (
        <div className="rounded-lg border-2 border-border bg-card overflow-hidden">
          {/*
            Outer vertical scroll; inner horizontal scroll is on the grid
            itself so the sticky header stays aligned with the body.
          */}
          <div className="max-h-[720px] overflow-auto">
            <div
              className="grid"
              style={{
                gridTemplateColumns: `64px repeat(${venueCount}, minmax(${VENUE_COL_MIN}px, 1fr))`,
              }}
            >
              {/* Sticky header row */}
              <div className="sticky top-0 left-0 z-20 bg-muted border-b-2 border-r border-border h-12" />
              {venues.map((v, i) => (
                <div
                  key={v.id}
                  className={cn(
                    "sticky top-0 z-10 bg-muted border-b-2 border-border h-12 px-2 flex items-center justify-center",
                    i < venueCount - 1 && "border-r",
                  )}
                  title={v.title}
                >
                  <span className="text-sm font-semibold leading-tight truncate text-center">
                    {v.title || "Untitled venue"}
                  </span>
                </div>
              ))}

              {/* Hour labels column (sticky to the left for horizontal scroll) */}
              <div className="sticky left-0 z-10 bg-card border-r border-border">
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

              {/* Venue columns */}
              {perVenue.map(({ venue, busyBlocks, openBlocks }, i) => {
                const closedBlocks = computeClosedBlocks(openBlocks, dayKey)
                const handleColumnClick = (
                  e: React.MouseEvent<HTMLDivElement>,
                ) => {
                  if (!onCreateAt) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const y = e.clientY - rect.top
                  // Suppress create-modal clicks inside the "closed" band
                  // so we don't invite scheduling at times the venue is
                  // actually closed.
                  const inClosed = closedBlocks.some(
                    (c) => y >= c.top && y < c.top + c.height,
                  )
                  if (inClosed) return
                  const minuteOfDay = Math.max(
                    0,
                    Math.min(
                      DAY_MINUTES - 15,
                      Math.round((y / HOUR_HEIGHT) * 60),
                    ),
                  )
                  const rounded = Math.round(minuteOfDay / 15) * 15
                  const hh = String(Math.floor(rounded / 60)).padStart(2, "0")
                  const mm = String(rounded % 60).padStart(2, "0")
                  const naive = `${dayKey}T${hh}:${mm}:00`
                  const guess = Date.parse(`${naive}Z`)
                  const offsetMin = tzOffsetMinutes(guess, timezone)
                  const utc = new Date(guess - offsetMin * 60_000)
                  onCreateAt(venue.id, utc.toISOString())
                }
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: absolute-positioned calendar surface; a <button> would break overlay layout
                  <div
                    key={venue.id}
                    onClick={handleColumnClick}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        handleColumnClick(
                          e as unknown as React.MouseEvent<HTMLDivElement>,
                        )
                    }}
                    role={onCreateAt ? "button" : undefined}
                    tabIndex={onCreateAt ? 0 : undefined}
                    className={cn(
                      "relative",
                      i < venueCount - 1 && "border-r border-border",
                      onCreateAt && "cursor-crosshair",
                    )}
                    style={{ height: HOUR_HEIGHT * 24 }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={h}
                        style={{ top: h * HOUR_HEIGHT }}
                        className="absolute left-0 right-0 border-t border-border"
                      />
                    ))}

                    {closedBlocks.map((c) => (
                      <div
                        key={c.key}
                        style={{ top: c.top, height: c.height }}
                        className="absolute left-0 right-0 bg-muted/60 dark:bg-muted/40"
                      />
                    ))}

                    {busyBlocks.map((b) => {
                      const isClosedException = b.source === "exception"
                      const setupH = ((b.setupMinutes ?? 0) / 60) * HOUR_HEIGHT
                      const teardownH =
                        ((b.teardownMinutes ?? 0) / 60) * HOUR_HEIGHT
                      const handleBlockClick = (ev: React.SyntheticEvent) => {
                        if (isClosedException && onExceptionClick) {
                          ev.stopPropagation()
                          onExceptionClick(b.label || null)
                          return
                        }
                        if (b.eventId && onEventClick) {
                          ev.stopPropagation()
                          onEventClick(b.eventId)
                        }
                      }
                      const clickable =
                        (isClosedException && !!onExceptionClick) ||
                        (!!b.eventId && !!onEventClick)
                      return (
                        // biome-ignore lint/a11y/noStaticElementInteractions: absolute-positioned event block; <button> would cascade unwanted styles
                        <div
                          key={b.key}
                          style={{ top: b.top + 1, height: b.height - 2 }}
                          title={b.label}
                          onClick={handleBlockClick}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") handleBlockClick(ev)
                          }}
                          role={clickable ? "button" : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          className={cn(
                            "absolute left-1 right-1 rounded-md text-[11px] font-medium leading-tight overflow-hidden shadow-sm flex flex-col",
                            isClosedException
                              ? "bg-zinc-300 text-zinc-800 border border-zinc-500 border-dashed dark:bg-zinc-700 dark:text-zinc-100 dark:border-zinc-400"
                              : "bg-sky-600 text-white border border-sky-700 dark:bg-sky-500 dark:text-white dark:border-sky-400",
                            clickable && "cursor-pointer",
                          )}
                        >
                          {setupH > 1 && (
                            <div
                              style={{
                                height: setupH,
                                backgroundImage:
                                  "repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 4px, transparent 4px 8px)",
                              }}
                              aria-hidden
                              className="bg-sky-900 border-b border-sky-950 dark:bg-sky-900 dark:border-sky-950"
                              title="Setup"
                            />
                          )}
                          <div className="px-1.5 py-1 truncate">{b.label}</div>
                          {teardownH > 1 && (
                            <div
                              style={{
                                height: teardownH,
                                backgroundImage:
                                  "repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 4px, transparent 4px 8px)",
                              }}
                              aria-hidden
                              className="bg-sky-900 border-t border-sky-950 dark:bg-sky-900 dark:border-sky-950 mt-auto"
                              title="Teardown"
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-sky-600 dark:bg-sky-500" />
          Event
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-sm bg-sky-900"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 2px, transparent 2px 4px)",
            }}
          />
          Setup / Teardown
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-muted/60 border border-border dark:bg-muted/40" />
          Closed
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-zinc-300 border border-dashed border-zinc-500 dark:bg-zinc-700 dark:border-zinc-400" />
          Closed exception
        </div>
      </div>
    </div>
  )
}
