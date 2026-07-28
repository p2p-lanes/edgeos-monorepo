import { dayBoundsInTz } from "@edgeos/shared-events"
import { useQuery } from "@tanstack/react-query"
import { addDays, format, startOfDay, subDays } from "date-fns"
import {
  CalendarClock,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Home,
  Layers,
  Maximize2,
  Minimize2,
  Repeat,
  Tag,
} from "lucide-react"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"

import { type EventPublic, EventsService, EventVenuesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  type EventStatusFilter,
  resolveStatusFilter,
} from "@/lib/events/statusFilter"
import { summarizeRrule } from "@/lib/events/summarizeRrule"
import { useEventTimezone } from "@/lib/events/useEventTimezone"
import { cn } from "@/lib/utils"
import { EventVisibilityIcon } from "./EventBadges"

interface EventsDayViewProps {
  popupId: string
  status: EventStatusFilter | undefined
  venueId: string | undefined
  search: string
  selectedDate: Date | null
  onSelectedDateChange: (date: Date) => void
  defaultDate?: Date | null
  popupStart?: string | null
  popupEnd?: string | null
  onEventClick: (event: EventPublic) => void
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
}

function parsePopupDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const ymd = value.slice(0, 10)
  const [y, m, d] = ymd.split("-").map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 12, 0, 0)
}

function localYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

const HOUR_PX = 56
const MIN_PX = HOUR_PX / 60
const HOUR_LABEL_COL = 56
const VENUE_COL_MIN = 180

const M_HOUR_W = 64
const M_MIN_W = M_HOUR_W / 60
const M_LANE_H = 64
const M_HEADER_H = 32
const M_VENUE_LABEL_H = 28

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
 * Day timeline grouped by venue. Each venue gets its own column with
 * hours as rows; concurrent events at the same venue stack into lanes.
 * Mobile renders a transposed layout where venues are rows and hours
 * are columns. Mirrors the portal day view minus RSVP / owner badges.
 */
export function EventsDayView({
  popupId,
  status,
  venueId,
  search,
  selectedDate: selectedDateProp,
  onSelectedDateChange,
  defaultDate,
  popupStart,
  popupEnd,
  onEventClick,
  isFullscreen = false,
  onToggleFullscreen,
}: EventsDayViewProps) {
  const minDate = useMemo(() => parsePopupDate(popupStart), [popupStart])
  const maxDate = useMemo(() => parsePopupDate(popupEnd), [popupEnd])
  const minYmd = popupStart?.slice(0, 10) ?? null
  const maxYmd = popupEnd?.slice(0, 10) ?? null

  const selectedDate = useMemo(() => {
    const base = selectedDateProp ?? defaultDate ?? startOfDay(new Date())
    const baseYmd = localYmd(base)
    if (minYmd && baseYmd < minYmd && minDate) return minDate
    if (maxYmd && baseYmd > maxYmd && maxDate) return maxDate
    return base
  }, [selectedDateProp, defaultDate, minDate, maxDate, minYmd, maxYmd])

  const setSelectedDate = (next: Date | ((prev: Date) => Date)) => {
    const resolved = typeof next === "function" ? next(selectedDate) : next
    const resolvedYmd = localYmd(resolved)
    if (minYmd && resolvedYmd < minYmd && minDate) {
      onSelectedDateChange(minDate)
      return
    }
    if (maxYmd && resolvedYmd > maxYmd && maxDate) {
      onSelectedDateChange(maxDate)
      return
    }
    onSelectedDateChange(resolved)
  }
  const selectedYmd = localYmd(selectedDate)
  const canGoPrev = !minYmd || selectedYmd > minYmd
  const canGoNext = !maxYmd || selectedYmd < maxYmd
  const { timezone, formatTime, formatDayKey } = useEventTimezone(popupId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const mobileScrollRef = useRef<HTMLDivElement>(null)

  // Day-key is the YYYY-MM-DD the user picked in the date picker — interpret
  // it as a calendar day in the popup's timezone so bucketing matches the
  // calendar view and the backend's wall-clock view of the event.
  const dayKey = useMemo(() => localYmd(selectedDate), [selectedDate])

  // 24h ±1 day window anchored at the popup-tz day boundaries. Padding
  // catches events that straddle midnight in the popup tz so the projected
  // bucket stays inside the queried range.
  const window = useMemo(() => {
    const { start } = dayBoundsInTz(dayKey, timezone)
    return {
      startAfter: subDays(start, 1).toISOString(),
      startBefore: addDays(start, 2).toISOString(),
    }
  }, [dayKey, timezone])

  const { data: venuesData } = useQuery({
    queryKey: ["event-venues", { popupId, limit: 200 }],
    queryFn: () => EventVenuesService.listVenues({ popupId, limit: 200 }),
    enabled: !!popupId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ["events", "day", popupId, dayKey, status, venueId, search],
    queryFn: () =>
      EventsService.listEvents({
        popupId,
        ...resolveStatusFilter(status),
        venueId:
          venueId && venueId !== "custom" && venueId !== "meeting"
            ? venueId
            : undefined,
        locationKind:
          venueId === "custom" || venueId === "meeting" ? venueId : undefined,
        search: search || undefined,
        startAfter: window.startAfter,
        startBefore: window.startBefore,
        limit: 500,
      }),
    enabled: !!popupId,
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

  // "Now" indicator. Only rendered when the selected day matches today
  // in the popup timezone. `now` ticks once a minute so the line creeps
  // down without re-rendering on every frame.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const isViewingToday = useMemo(
    () => formatDayKey(now.toISOString()) === dayKey,
    [formatDayKey, now, dayKey],
  )
  const nowMin = useMemo(
    () => minutesInTz(now.toISOString()),
    [minutesInTz, now],
  )

  const dayEvents = useMemo(() => {
    const all = eventsData?.results ?? []
    return all.filter((e) => formatDayKey(e.start_time) === dayKey)
  }, [eventsData, dayKey, formatDayKey])

  // Always show every venue we know about so the layout is stable as
  // the user pages through days. Append synthetic "no venue" and
  // "off-site" columns only if such events exist on this day.
  const columns: VenueColumn[] = useMemo(() => {
    const venues = venuesData?.results ?? []
    const cols: VenueColumn[] = venues.map((v) => ({
      id: v.id,
      title: v.title,
    }))
    if (dayEvents.some((e) => !e.venue_id && !e.custom_location_name)) {
      cols.push({ id: "__no_venue__", title: "No venue" })
    }
    if (dayEvents.some((e) => !e.venue_id && !!e.custom_location_name)) {
      cols.push({ id: "__custom_location__", title: "Off-site" })
    }
    return cols
  }, [venuesData, dayEvents])

  const columnEvents = useMemo(() => {
    const map = new Map<string, PositionedEvent[]>()
    for (const col of columns) map.set(col.id, [])

    for (const event of dayEvents) {
      const colId =
        event.venue_id ??
        (event.custom_location_name ? "__custom_location__" : "__no_venue__")
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

  // Auto-scroll to the earliest event on day change. Keyed by dayKey so
  // background refetches don't yank the user back.
  const autoScrolledDayKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (autoScrolledDayKeyRef.current === dayKey) return
    if (!scrollRef.current && !mobileScrollRef.current) return
    autoScrolledDayKeyRef.current = dayKey
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
  }, [columnEvents, dayKey])

  const goPrev = () => setSelectedDate((d) => subDays(d, 1))
  const goNext = () => setSelectedDate((d) => addDays(d, 1))
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  const hours = Array.from({ length: 24 }, (_, i) => i)
  const venueCount = columns.length
  const isLoading = eventsLoading

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goPrev}
            disabled={!canGoPrev}
            aria-label="Previous day"
            title="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goNext}
            disabled={!canGoNext}
            aria-label="Next day"
            title="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex flex-col items-end min-w-0">
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm font-semibold capitalize truncate hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  aria-label="Pick a date"
                  title="Pick a date"
                >
                  <span className="truncate">
                    {format(selectedDate, "EEEE, MMMM d, yyyy")}
                  </span>
                  <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  defaultMonth={selectedDate}
                  onSelect={(d) => {
                    if (d) {
                      setSelectedDate(startOfDay(d))
                      setDatePickerOpen(false)
                    }
                  }}
                  disabled={(d) => {
                    const ymd = localYmd(d)
                    if (minYmd && ymd < minYmd) return true
                    if (maxYmd && ymd > maxYmd) return true
                    return false
                  }}
                  startMonth={minDate ?? undefined}
                  endMonth={maxDate ?? undefined}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
            <span className="text-[11px] text-muted-foreground">
              {totalEvents} {totalEvents === 1 ? "event" : "events"}
              {timezone ? ` · ${timezone}` : ""}
            </span>
          </div>
          {onToggleFullscreen && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : venueCount === 0 ? (
        <div className="text-center py-16 px-4">
          <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No venues</p>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className={cn(
              "hidden md:block overflow-auto",
              isFullscreen ? "max-h-[calc(100vh-9rem)]" : "max-h-[70vh]",
            )}
          >
            <div
              className="grid"
              style={{
                gridTemplateColumns: `${HOUR_LABEL_COL}px repeat(${venueCount}, minmax(${VENUE_COL_MIN}px, 1fr))`,
              }}
            >
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
                    {col.title || "Untitled venue"}
                  </span>
                </div>
              ))}

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
                    {isViewingToday && (
                      <div
                        className="absolute left-0 right-0 z-10 h-0.5 bg-destructive pointer-events-none"
                        style={{ top: nowMin * MIN_PX }}
                        aria-hidden="true"
                      />
                    )}
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
                            ? "Part of a recurring series"
                            : null)
                        const isHighlighted = event.highlighted === true
                        return (
                          <button
                            key={event.id}
                            type="button"
                            onClick={() => onEventClick(event)}
                            className={cn(
                              "absolute rounded-md border transition-colors p-1.5 overflow-hidden text-xs text-left",
                              isHighlighted
                                ? "border-warning/25 bg-warning-soft hover:bg-warning/20"
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
                              {!event.venue_id &&
                                event.custom_location_name && (
                                  <Home
                                    className="h-3 w-3 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
                                  />
                                )}
                              <EventVisibilityIcon
                                visibility={event.visibility}
                                className="h-3 w-3"
                              />
                              <span
                                className={cn(
                                  isShort ? "truncate" : "line-clamp-2",
                                )}
                              >
                                {event.title}
                              </span>
                            </div>
                            {!isShort &&
                              !event.venue_id &&
                              event.custom_location_name && (
                                <div className="text-[10px] text-muted-foreground/80 truncate">
                                  {event.custom_location_name}
                                </div>
                              )}
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
                              <div className="flex items-center gap-1 text-[10px] font-medium text-chart-3 mt-0.5">
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
                                      className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded border border-border bg-background/60 text-muted-foreground"
                                    >
                                      <Tag className="h-2 w-2" />
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                          </button>
                        )
                      },
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* MOBILE TRANSPOSED — venues as rows, hours as columns. */}
          <div
            ref={mobileScrollRef}
            className={cn(
              "md:hidden overflow-auto",
              isFullscreen ? "max-h-[calc(100vh-9rem)]" : "max-h-[70vh]",
            )}
          >
            <div style={{ width: 24 * M_HOUR_W }}>
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
                          {col.title || "Untitled venue"}
                        </span>
                      </div>
                    </div>
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
                      {isViewingToday && (
                        <div
                          className="absolute top-0 bottom-0 z-10 w-0.5 bg-destructive pointer-events-none"
                          style={{ left: nowMin * M_MIN_W }}
                          aria-hidden="true"
                        />
                      )}
                      {items.map(({ event, startMin, endMin, laneIndex }) => {
                        const left = startMin * M_MIN_W
                        const width = Math.max(
                          24,
                          (endMin - startMin) * M_MIN_W - 2,
                        )
                        const top = laneIndex * M_LANE_H + 2
                        const height = M_LANE_H - 4
                        const isShort = endMin - startMin < 60
                        const isHighlighted = event.highlighted === true
                        return (
                          <button
                            key={event.id}
                            type="button"
                            onClick={() => onEventClick(event)}
                            className={cn(
                              "absolute rounded-md border transition-colors px-1.5 py-1 overflow-hidden text-left",
                              isHighlighted
                                ? "border-warning/25 bg-warning-soft hover:bg-warning/20"
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
                              {!event.venue_id &&
                                event.custom_location_name && (
                                  <Home
                                    className="h-2.5 w-2.5 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
                                  />
                                )}
                              <EventVisibilityIcon
                                visibility={event.visibility}
                                className="h-2.5 w-2.5"
                              />
                              <span className="truncate">{event.title}</span>
                            </div>
                            <div className="flex items-center gap-1 text-[9px] text-muted-foreground mt-0.5">
                              <Clock className="h-2 w-2" />
                              <span className="truncate">
                                {formatTime(event.start_time)}
                                {!isShort && ` – ${formatTime(event.end_time)}`}
                              </span>
                            </div>
                          </button>
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
