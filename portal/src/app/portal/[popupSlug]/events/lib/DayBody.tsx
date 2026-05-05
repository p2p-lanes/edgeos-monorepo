"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { addDays, format, startOfDay, subDays } from "date-fns"
import {
  CalendarClock,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  Repeat,
  Star,
  Tag,
} from "lucide-react"
import Link from "next/link"
import { Fragment, useEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"

import {
  EventParticipantsService,
  type EventPublic,
  EventsService,
  EventVenuesService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { summarizeRrule } from "./summarizeRrule"
import { useEventTimezone } from "./useEventTimezone"

interface DayBodyProps {
  popupId: string | undefined
  slug: string | undefined
  search: string
  rsvpedOnly: boolean
  tags?: string[]
  trackIds?: string[]
  selectedDate: Date | null
  onSelectedDateChange: (date: Date) => void
  /** Fallback when no `?date=` URL param is present. Defaults to today. */
  defaultDate?: Date | null
}

const HOUR_PX = 56
const MIN_PX = HOUR_PX / 60
const HOUR_LABEL_COL = 56 // px width of the time-label column
const VENUE_COL_MIN = 180 // px — readable venue name + event title

// --- Mobile transposed layout (REVERTIBLE: see "MOBILE TRANSPOSED" block
// below; remove the block + this constants group + the mobileScrollRef
// useEffect to fall back to desktop-grid-only.)
const M_HOUR_W = 64 // px width per hour column on mobile
const M_MIN_W = M_HOUR_W / 60
const M_LANE_H = 64 // px height per overlap lane within a venue row
const M_HEADER_H = 32 // px sticky hour-labels row on mobile
const M_VENUE_LABEL_H = 28 // px row header band that holds the sticky venue name

interface VenueColumn {
  id: string
  title: string
}

interface PositionedEvent {
  event: EventPublic
  startMin: number
  endMin: number
  laneIndex: number
  laneCount: number
}

/**
 * Day timeline grouped by venue. Each venue gets its own column with hours
 * as rows; concurrent events at the same venue stack into lanes within
 * that venue's column. Layout mirrors the backoffice "Day by venue" view
 * for visual consistency. Honors the popup timezone for both filtering
 * and event positioning.
 */
export function DayBody({
  popupId,
  slug,
  search,
  rsvpedOnly,
  tags,
  trackIds,
  selectedDate: selectedDateProp,
  onSelectedDateChange,
  defaultDate,
}: DayBodyProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  // Fall back to the popup's first booking day (or today, before the
  // popup record loads) when the parent hasn't set a date yet — no
  // `?date=` in the URL on first visit.
  const selectedDate = useMemo(
    () => selectedDateProp ?? defaultDate ?? startOfDay(new Date()),
    [selectedDateProp, defaultDate],
  )
  const setSelectedDate = (next: Date | ((prev: Date) => Date)) => {
    const resolved = typeof next === "function" ? next(selectedDate) : next
    onSelectedDateChange(resolved)
  }
  const { timezone, formatTime, formatDayKey } = useEventTimezone(popupId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const mobileScrollRef = useRef<HTMLDivElement>(null)

  // 24h ±1 day window in UTC. Padding catches events whose UTC start lands
  // on the day before/after when re-projected into the popup's timezone.
  const window = useMemo(() => {
    const start = new Date(selectedDate)
    start.setHours(0, 0, 0, 0)
    return {
      startAfter: subDays(start, 1).toISOString(),
      startBefore: addDays(start, 2).toISOString(),
    }
  }, [selectedDate])

  // Stable day key in browser-local terms; the events query then filters
  // events whose popup-timezone day matches it.
  const dayKey = useMemo(() => {
    const y = selectedDate.getFullYear()
    const m = String(selectedDate.getMonth() + 1).padStart(2, "0")
    const d = String(selectedDate.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }, [selectedDate])

  const { data: venuesData } = useQuery({
    queryKey: ["portal-venues-day", popupId],
    queryFn: () =>
      EventVenuesService.listPortalVenues({
        popupId: popupId!,
        limit: 200,
      }),
    enabled: !!popupId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: eventsData, isLoading } = useQuery({
    queryKey: [
      "portal-events-day",
      popupId,
      dayKey,
      rsvpedOnly,
      search,
      tags,
      trackIds,
    ],
    queryFn: () =>
      EventsService.listPortalEvents({
        popupId: popupId!,
        eventStatus: "published",
        startAfter: window.startAfter,
        startBefore: window.startBefore,
        rsvpedOnly: rsvpedOnly || undefined,
        search: search || undefined,
        tags: tags?.length ? tags : undefined,
        trackIds: trackIds?.length ? trackIds : undefined,
        limit: 500,
      }),
    enabled: !!popupId,
  })

  // For recurring instances we must include occurrence_start; one-off events
  // must not. Use occurrence_id (set only on virtual occurrences) to decide.
  const rsvpBodyFor = (e: EventPublic) =>
    e.occurrence_id ? { occurrence_start: e.start_time } : undefined
  const rsvpMutation = useMutation({
    mutationFn: (e: EventPublic) =>
      EventParticipantsService.registerForEvent({
        eventId: e.id,
        requestBody: rsvpBodyFor(e),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-events-day"] })
    },
  })
  const cancelRsvpMutation = useMutation({
    mutationFn: (e: EventPublic) =>
      EventParticipantsService.cancelRegistration({
        eventId: e.id,
        requestBody: rsvpBodyFor(e),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-events-day"] })
    },
  })

  // "HH:MM" in the popup timezone (24h) -> minutes since 00:00.
  const minutesInTz = useMemo(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    return (iso: string): number => {
      const [h, m] = fmt.format(new Date(iso)).split(":").map(Number)
      return h * 60 + m
    }
  }, [timezone])

  // Filter to events whose popup-timezone day matches the selected day.
  const dayEvents = useMemo(() => {
    const all = eventsData?.results ?? []
    return all.filter((e) => formatDayKey(e.start_time) === dayKey)
  }, [eventsData, dayKey, formatDayKey])

  // Build the column list. Always show every venue we know about, even
  // those without events on this day, so the calendar layout is stable
  // as the user pages through days. Append a synthetic "no venue" column
  // only when at least one event lacks a venue.
  const columns: VenueColumn[] = useMemo(() => {
    const venues = venuesData?.results ?? []
    const cols: VenueColumn[] = venues.map((v) => ({
      id: v.id,
      title: v.title,
    }))
    if (dayEvents.some((e) => !e.venue_id)) {
      cols.push({ id: "__no_venue__", title: t("events.day.no_venue_column") })
    }
    return cols
  }, [venuesData, dayEvents, t])

  // For each column, lay events into overlap lanes (same logic as the
  // first iteration, but scoped per venue so a busy venue doesn't squeeze
  // other venues' columns).
  const columnEvents = useMemo(() => {
    const map = new Map<string, PositionedEvent[]>()
    for (const col of columns) map.set(col.id, [])

    for (const event of dayEvents) {
      const colId = event.venue_id ?? "__no_venue__"
      if (!map.has(colId)) continue
      const startMin = minutesInTz(event.start_time)
      const endsOnDay = formatDayKey(event.end_time) === dayKey
      const rawEndMin = endsOnDay ? minutesInTz(event.end_time) : 24 * 60
      const endMin = Math.max(rawEndMin, startMin + 30)
      map
        .get(colId)!
        .push({ event, startMin, endMin, laneIndex: 0, laneCount: 1 })
    }

    for (const [, items] of map) {
      items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
      const lanes: number[] = []
      let clusterEnd = -1
      let clusterStartIdx = 0
      const flushCluster = (endIdx: number) => {
        const laneCount = lanes.length
        for (let i = clusterStartIdx; i < endIdx; i++) {
          items[i] = { ...items[i], laneCount }
        }
        lanes.length = 0
      }
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.startMin >= clusterEnd) {
          flushCluster(i)
          clusterStartIdx = i
          clusterEnd = it.endMin
        } else {
          clusterEnd = Math.max(clusterEnd, it.endMin)
        }
        let lane = lanes.findIndex((end) => end <= it.startMin)
        if (lane === -1) {
          lane = lanes.length
          lanes.push(it.endMin)
        } else {
          lanes[lane] = it.endMin
        }
        items[i] = { ...it, laneIndex: lane }
      }
      flushCluster(items.length)
    }
    return map
  }, [columns, dayEvents, minutesInTz, formatDayKey, dayKey])

  const totalEvents = dayEvents.length

  // `from` carries the events-page URL state (view + date) so the event
  // detail page can return the user to the same calendar spot via its
  // "Back to events" link. `occ` carries the specific occurrence's start
  // time so the detail page renders the clicked instance (not the series'
  // first occurrence) for recurring events.
  const fromParam = useMemo(
    () => encodeURIComponent(`view=day&date=${dayKey}`),
    [dayKey],
  )
  const eventHref = (event: EventPublic) => {
    const base = `/portal/${slug}/events/${event.id}?from=${fromParam}`
    return event.occurrence_id
      ? `${base}&occ=${encodeURIComponent(event.start_time)}`
      : base
  }

  // Auto-scroll to the earliest event of the day. On desktop we scroll
  // the venue grid vertically; on mobile (transposed) we scroll the venue
  // rows horizontally. On empty days settle near 8:00 instead of 00:00.
  useEffect(() => {
    let earliest = Number.POSITIVE_INFINITY
    for (const items of columnEvents.values()) {
      if (items.length > 0 && items[0].startMin < earliest) {
        earliest = items[0].startMin
      }
    }
    const anchor = Number.isFinite(earliest) ? earliest : 8 * 60
    if (scrollRef.current) {
      const target = Math.max(0, anchor * MIN_PX - HOUR_PX)
      scrollRef.current.scrollTo({ top: target, behavior: "smooth" })
    }
    if (mobileScrollRef.current) {
      const target = Math.max(0, anchor * M_MIN_W - M_HOUR_W)
      mobileScrollRef.current.scrollTo({ left: target, behavior: "smooth" })
    }
  }, [columnEvents])

  const goPrev = () => setSelectedDate((d) => subDays(d, 1))
  const goNext = () => setSelectedDate((d) => addDays(d, 1))

  const hours = Array.from({ length: 24 }, (_, i) => i)
  const venueCount = columns.length

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goPrev}
            aria-label={t("events.day.prev_day")}
            title={t("events.day.prev_day")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goNext}
            aria-label={t("events.day.next_day")}
            title={t("events.day.next_day")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col items-end min-w-0">
          <h2 className="text-sm font-semibold capitalize truncate">
            {format(selectedDate, "EEEE, MMMM d, yyyy")}
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {t("events.day.event_count", { count: totalEvents })}
            {timezone ? ` · ${timezone}` : ""}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : venueCount === 0 ? (
        <div className="text-center py-16 px-4">
          <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">
            {t("events.day.no_venues")}
          </p>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="hidden md:block max-h-[70vh] overflow-auto"
          >
            <div
              className="grid"
              style={{
                gridTemplateColumns: `${HOUR_LABEL_COL}px repeat(${venueCount}, minmax(${VENUE_COL_MIN}px, 1fr))`,
              }}
            >
              {/* Sticky header row */}
              <div className="sticky top-0 left-0 z-20 bg-muted border-b border-r border-border h-10" />
              {columns.map((col, i) => (
                <div
                  key={col.id}
                  className={cn(
                    "sticky top-0 z-10 bg-muted border-b border-border h-10 px-2 flex items-center justify-center",
                    i < venueCount - 1 && "border-r",
                  )}
                  title={col.title}
                >
                  <span className="text-xs font-semibold leading-tight truncate text-center">
                    {col.title || t("events.day.untitled_venue")}
                  </span>
                </div>
              ))}

              {/* Hour-labels column (sticky to the left for horizontal scroll) */}
              <div className="sticky left-0 z-10 bg-card border-r border-border">
                {hours.map((h) => (
                  <div
                    key={h}
                    style={{ height: HOUR_PX }}
                    className="flex items-start justify-end pr-2 pt-0.5 text-[10px] font-medium text-muted-foreground border-t border-border/50 first:border-t-0"
                  >
                    {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                  </div>
                ))}
              </div>

              {/* Venue columns */}
              {columns.map((col, colIdx) => {
                const items = columnEvents.get(col.id) ?? []
                return (
                  <div
                    key={col.id}
                    className={cn(
                      "relative",
                      colIdx < venueCount - 1 && "border-r border-border",
                    )}
                    style={{ height: HOUR_PX * 24 }}
                  >
                    {hours.map((h) => (
                      <div
                        key={h}
                        style={{ top: h * HOUR_PX }}
                        className="absolute left-0 right-0 border-t border-border/50 first:border-t-0"
                      />
                    ))}
                    {items.map(
                      ({ event, startMin, endMin, laneIndex, laneCount }) => {
                        const top = startMin * MIN_PX
                        const height = Math.max(
                          20,
                          (endMin - startMin) * MIN_PX - 2,
                        )
                        const widthPct = 100 / laneCount
                        const leftPct = laneIndex * widthPct
                        const isShort = endMin - startMin < 60
                        const recurrenceLabel =
                          summarizeRrule(event.rrule) ??
                          (event.recurrence_master_id
                            ? t("events.list.part_of_recurring_series")
                            : null)
                        const isRsvpd =
                          !!event.my_rsvp_status &&
                          event.my_rsvp_status !== "cancelled"
                        const isHighlighted = event.highlighted === true
                        return (
                          <Link
                            key={event.id}
                            href={eventHref(event)}
                            className={cn(
                              "absolute rounded-md border transition-colors p-1.5 overflow-hidden text-xs",
                              isHighlighted
                                ? "border-amber-400 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/60"
                                : "border-primary/30 bg-primary/10 hover:bg-primary/20",
                            )}
                            style={{
                              top: `${top}px`,
                              height: `${height}px`,
                              left: `calc(${leftPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                            }}
                          >
                            <div
                              className={cn(
                                "font-medium leading-tight flex items-center gap-1",
                                isShort ? "truncate" : "line-clamp-2",
                              )}
                            >
                              {isHighlighted && (
                                <Star
                                  className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500"
                                  aria-label={t(
                                    "events.list.highlighted_title",
                                  )}
                                />
                              )}
                              <span
                                className={cn(
                                  isShort ? "truncate" : "line-clamp-2",
                                )}
                              >
                                {event.title}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                              <Clock className="h-2.5 w-2.5" />
                              <span className="truncate">
                                {formatTime(event.start_time)} –{" "}
                                {formatTime(event.end_time)}
                              </span>
                            </div>
                            {!isShort && recurrenceLabel && (
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                                <Repeat className="h-2.5 w-2.5" />
                                <span className="truncate">
                                  {recurrenceLabel}
                                </span>
                              </div>
                            )}
                            {!isShort && event.track_title && (
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                                <Layers className="h-2.5 w-2.5" />
                                <span className="truncate">
                                  {event.track_title}
                                </span>
                              </div>
                            )}
                            {!isShort &&
                              event.tags &&
                              event.tags.length > 0 && (
                                <div className="flex items-center gap-0.5 mt-1 flex-wrap">
                                  {event.tags.slice(0, 2).map((tag) => (
                                    <span
                                      key={tag}
                                      className="inline-flex items-center gap-0.5 text-[9px] bg-background/60 px-1 py-0.5 rounded"
                                    >
                                      <Tag className="h-2 w-2" />
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            {!isShort && event.status === "published" && (
                              <div className="absolute bottom-1 right-1">
                                {isRsvpd ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      cancelRsvpMutation.mutate(event)
                                    }}
                                    className="inline-flex items-center gap-0.5 rounded border border-primary/40 bg-primary/20 px-1 py-0.5 text-[9px] font-medium text-primary hover:bg-primary/30"
                                  >
                                    <CheckCircle className="h-2.5 w-2.5" />
                                    {t("events.rsvp.going")}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      rsvpMutation.mutate(event)
                                    }}
                                    className="inline-flex items-center rounded border bg-background px-1 py-0.5 text-[9px] font-medium hover:bg-muted"
                                  >
                                    {t("events.rsvp.rsvp")}
                                  </button>
                                )}
                              </div>
                            )}
                          </Link>
                        )
                      },
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* MOBILE TRANSPOSED — venues as rows, hours as columns. The venue
            name lives in a "label band" above each row instead of in a
            left column, so the timeline can scroll edge-to-edge. The name
            inside the band is sticky-left so it remains visible while the
            user scrolls horizontally. To revert this experiment: delete
            this entire block, the mobileScrollRef, its useEffect branch,
            the M_* constants, and remove the "hidden md:block" class on
            the desktop grid above. */}
          <div
            ref={mobileScrollRef}
            className="md:hidden max-h-[70vh] overflow-auto"
          >
            <div style={{ width: 24 * M_HOUR_W }}>
              {/* Sticky hour-labels row spans the full timeline width */}
              <div
                className="sticky top-0 z-20 bg-muted border-b border-border flex"
                style={{ height: M_HEADER_H }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className={cn(
                      "shrink-0 flex items-center justify-start pl-1.5 text-[10px] font-medium text-muted-foreground",
                      h < 23 && "border-r border-border",
                    )}
                    style={{ width: M_HOUR_W, height: M_HEADER_H }}
                  >
                    {`${String(h).padStart(2, "0")}:00`}
                  </div>
                ))}
              </div>

              {columns.map((col) => {
                const items = columnEvents.get(col.id) ?? []
                const laneCount = items.reduce(
                  (max, it) => Math.max(max, it.laneCount),
                  1,
                )
                const rowHeight = Math.max(M_LANE_H, laneCount * M_LANE_H)
                return (
                  <Fragment key={col.id}>
                    {/* Venue-label band: full timeline width, but the text
                      inside is sticky-left so it stays pinned at the
                      viewport edge while the timeline below scrolls.
                      The band is also sticky to the top of the scroll
                      container (under the hour-labels row) so the venue
                      name stays visible while the user scrolls down
                      through this venue's events. */}
                    <div
                      className="sticky z-10 bg-muted/60 border-b border-border backdrop-blur-sm"
                      style={{
                        top: M_HEADER_H,
                        height: M_VENUE_LABEL_H,
                      }}
                      title={col.title}
                    >
                      <div className="sticky left-0 inline-flex items-center h-full max-w-[80vw] px-2 bg-muted/60">
                        <span className="text-[11px] font-semibold leading-tight truncate">
                          {col.title || t("events.day.untitled_venue")}
                        </span>
                      </div>
                    </div>
                    {/* Timeline area: full width, no left column eating space */}
                    <div
                      className="relative border-b border-border"
                      style={{ height: rowHeight }}
                    >
                      {hours.map((h) => (
                        <div
                          key={h}
                          className={cn(
                            "absolute top-0 bottom-0 border-l border-border/40",
                            h === 0 && "border-l-0",
                          )}
                          style={{ left: h * M_HOUR_W }}
                        />
                      ))}
                      {items.map(({ event, startMin, endMin, laneIndex }) => {
                        const left = startMin * M_MIN_W
                        const width = Math.max(
                          24,
                          (endMin - startMin) * M_MIN_W - 2,
                        )
                        const top = laneIndex * M_LANE_H + 2
                        const height = M_LANE_H - 4
                        const isShort = endMin - startMin < 60
                        const isRsvpd =
                          !!event.my_rsvp_status &&
                          event.my_rsvp_status !== "cancelled"
                        const isHighlighted = event.highlighted === true
                        return (
                          <Link
                            key={event.id}
                            href={eventHref(event)}
                            className={cn(
                              "absolute rounded-md border transition-colors px-1.5 py-1 overflow-hidden",
                              isHighlighted
                                ? "border-amber-400 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/60"
                                : "border-primary/30 bg-primary/10 hover:bg-primary/20",
                            )}
                            style={{
                              left: `${left + 1}px`,
                              width: `${width}px`,
                              top: `${top}px`,
                              height: `${height}px`,
                            }}
                          >
                            <div className="font-medium text-[11px] leading-tight truncate flex items-center gap-1">
                              {isHighlighted && (
                                <Star
                                  className="h-2.5 w-2.5 shrink-0 fill-amber-400 text-amber-500"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="truncate">{event.title}</span>
                            </div>
                            <div className="flex items-center gap-1 text-[9px] text-muted-foreground mt-0.5">
                              <Clock className="h-2 w-2" />
                              <span className="truncate">
                                {formatTime(event.start_time)}
                                {!isShort && ` – ${formatTime(event.end_time)}`}
                              </span>
                              {isRsvpd && (
                                <CheckCircle className="h-2.5 w-2.5 text-primary ml-auto shrink-0" />
                              )}
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  </Fragment>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
