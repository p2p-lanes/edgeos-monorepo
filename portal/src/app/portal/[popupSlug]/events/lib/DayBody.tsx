"use client"

import { useQuery } from "@tanstack/react-query"
import { addDays, startOfDay, subDays } from "date-fns"
import {
  CalendarClock,
  CalendarIcon,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Home,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Repeat,
  Tag,
} from "lucide-react"
import Link from "next/link"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { type EventPublic, EventVenuesService, HumansService } from "@/client"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { EventsScrollSnapshot } from "./eventsViewState"
import { fetchAllPortalEvents } from "./fetchAllPortalEvents"
import { summarizeRrule } from "./summarizeRrule"
import { useEventRsvp } from "./useEventRsvp"
import { useEventTimezone } from "./useEventTimezone"

interface DayBodyProps {
  popupId: string | undefined
  slug: string | undefined
  search: string
  rsvpedOnly: boolean
  /** "My events": owner/host/collaborator. Includes the manager's drafts. */
  mineOnly?: boolean
  tags?: string[]
  trackIds?: string[]
  selectedDate: Date | null
  onSelectedDateChange: (date: Date) => void
  /** Fallback when no `?date=` URL param is present. Defaults to today. */
  defaultDate?: Date | null
  /**
   * "authed" (default) renders the full portal experience. "public"
   * skips the authenticated current-human + venue queries, hides the
   * RSVP buttons, and delegates event clicks to ``onEventClick``.
   */
  mode?: "authed" | "public"
  /** Sources events from the parent instead of the authenticated query. */
  eventsOverride?: EventPublic[]
  /**
   * Public venue list (id + title) sourced from outside the authenticated
   * portal API — used to size the day-grid columns when ``mode==="public"``.
   */
  venuesOverride?: { id: string; title: string }[]
  /** Click handler; return ``true`` to suppress the default navigation. */
  onEventClick?: (event: EventPublic) => boolean | undefined
  /** Hard-coded timezone (skips the authenticated event-settings query). */
  timezoneOverride?: string
  /**
   * If present, the body restores these scroll positions on its first
   * render after returning from event detail and skips the
   * auto-scroll-to-earliest effect for that one mount. Subsequent date
   * changes resume the normal auto-scroll behavior.
   */
  restoredScroll?: EventsScrollSnapshot
  /**
   * Called right before the user follows an event link into the detail
   * page. The body owns its dayKey and inner-scroll positions.
   */
  onEventLinkClick?: (
    view: "day",
    dayKey: string,
    scroll: EventsScrollSnapshot,
  ) => void
  /**
   * When true, the body assumes its parent has rendered it inside a
   * fullscreen overlay and the inner scroll area should grow to fill the
   * viewport instead of capping at 70vh. The button itself only renders
   * when `onToggleFullscreen` is also provided.
   */
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
}

const HOUR_PX = 56
const MIN_PX = HOUR_PX / 60
const HOUR_LABEL_COL = 56 // px width of the time-label column
// Venue column sizing. The day view's purpose is to fit as many venues on
// screen as possible, so columns are denser than a typical agenda: a fixed
// max (no `1fr`) stops them from stretching to fill the viewport when there
// are only a few venues, and the lower min lets more columns fit before the
// grid needs to scroll horizontally.
const VENUE_COL_MIN = 120 // px floor before horizontal scroll kicks in
const VENUE_COL_MAX = 160 // px cap so columns stay dense instead of stretching

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
  mineOnly,
  tags,
  trackIds,
  selectedDate: selectedDateProp,
  onSelectedDateChange,
  defaultDate,
  restoredScroll,
  onEventLinkClick,
  isFullscreen = false,
  onToggleFullscreen,
  mode = "authed",
  eventsOverride,
  venuesOverride,
  onEventClick,
  timezoneOverride,
}: DayBodyProps) {
  const isAuthed = mode === "authed"
  const useOverride = eventsOverride !== undefined
  const { t } = useTranslation()
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
  const {
    timezone,
    locale,
    formatTime,
    formatDayKey,
    isLoading: tzLoading,
  } = useEventTimezone(popupId, timezoneOverride)

  // Localized "Monday, June 4, 2026" for the date picker trigger. Uses the
  // selected day's nominal local date (no TZ conversion needed — selectedDate
  // is already the user-picked wall-clock day).
  const formatDatePickerLabel = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(d)
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

  const { data: currentHuman } = useQuery({
    queryKey: ["current-human"],
    queryFn: () => HumansService.getCurrentHumanInfo(),
    staleTime: 5 * 60 * 1000,
    enabled: isAuthed,
  })

  const { data: venuesData } = useQuery({
    queryKey: ["portal-venues-day", popupId],
    queryFn: () =>
      EventVenuesService.listPortalVenues({
        popupId: popupId!,
        limit: 200,
      }),
    enabled: isAuthed && !!popupId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: [
      "portal-events-day",
      popupId,
      dayKey,
      rsvpedOnly,
      mineOnly,
      search,
      tags,
      trackIds,
    ],
    // Fetch every event of the day window across all pages (no cap) so a busy
    // day never silently truncates. Returns the merged, globally sorted list.
    queryFn: async () => ({
      results: await fetchAllPortalEvents({
        popupId: popupId!,
        eventStatus: mineOnly ? undefined : "published",
        startAfter: window.startAfter,
        startBefore: window.startBefore,
        rsvpedOnly: rsvpedOnly || undefined,
        managedOnly: mineOnly || undefined,
        search: search || undefined,
        tags: tags?.length ? tags : undefined,
        trackIds: trackIds?.length ? trackIds : undefined,
      }),
    }),
    enabled: isAuthed && !useOverride && !!popupId,
  })
  // Fold the settings-timezone load into the loading state: rendering the
  // day grid before the popup tz resolves would place events at the wrong
  // hour (browser-tz fallback) until settings arrive. With an override
  // (public calendar) the tz is known synchronously, so this stays false.
  const isLoading = useOverride ? false : eventsLoading || tzLoading

  const { rsvpMutation, cancelRsvpMutation, pendingRsvpKey } = useEventRsvp([
    "portal-events-day",
  ])

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

  // "Now" indicator: a red line that marks the current time on the
  // current day's grid. Only rendered when the selected day matches
  // today in the popup timezone. `now` ticks once a minute so the line
  // creeps down as time passes without re-rendering on every frame.
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

  // Filter to events whose popup-timezone day matches the selected day.
  const dayEvents = useMemo(() => {
    const all = useOverride
      ? (eventsOverride ?? [])
      : (eventsData?.results ?? [])
    return all.filter((e) => formatDayKey(e.start_time) === dayKey)
  }, [eventsData, eventsOverride, useOverride, dayKey, formatDayKey])

  // Build the column list. Always show every venue we know about, even
  // those without events on this day, so the calendar layout is stable
  // as the user pages through days. Append a synthetic "no venue" column
  // only when at least one event lacks a venue, and a separate "off-site"
  // column at the very end for events that have a custom location.
  const columns: VenueColumn[] = useMemo(() => {
    const venues = venuesOverride ?? venuesData?.results ?? []
    const cols: VenueColumn[] = venues.map((v) => ({
      id: v.id,
      title: v.title,
    }))
    if (dayEvents.some((e) => !e.venue_id && !e.custom_location_name)) {
      cols.push({ id: "__no_venue__", title: t("events.day.no_venue_column") })
    }
    if (dayEvents.some((e) => !e.venue_id && !!e.custom_location_name)) {
      cols.push({
        id: "__custom_location__",
        title: t("events.day.offsite_column"),
      })
    }
    return cols
  }, [venuesData, venuesOverride, dayEvents, t])

  // For each column, lay events into overlap lanes (same logic as the
  // first iteration, but scoped per venue so a busy venue doesn't squeeze
  // other venues' columns).
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
  const handleEventClick = (
    event: EventPublic,
    e: React.MouseEvent<HTMLAnchorElement>,
  ) => {
    if (onEventClick) {
      const handled = onEventClick(event)
      if (handled === true) {
        e.preventDefault()
        return
      }
    }
    if (!onEventLinkClick) return
    const main =
      typeof document !== "undefined"
        ? document.getElementById("portal-scroll")
        : null
    onEventLinkClick("day", dayKey, {
      outer: main?.scrollTop ?? 0,
      innerVertical: scrollRef.current?.scrollTop ?? 0,
      innerHorizontal: mobileScrollRef.current?.scrollLeft ?? 0,
    })
  }

  // Auto-scroll to the earliest event of the day. On desktop we scroll
  // the venue grid vertically; on mobile (transposed) we scroll the venue
  // rows horizontally. On empty days settle near 8:00 instead of 00:00.
  //
  // Auto-scroll fires once per day (keyed by `dayKey`) so background
  // refetches and RSVP mutations — both of which produce a fresh
  // `columnEvents` Map — don't yank the user back to the earliest event
  // every time the data updates. When returning from event detail with a
  // sessionStorage snapshot we instead restore the previous inner scroll
  // positions and mark the day as already-handled so the auto-scroll
  // branch doesn't immediately overwrite the restore. Restore is gated on
  // at least one scroll container being mounted, so a render while
  // `isLoading` is true (grid replaced by a spinner) defers the restore
  // until the grid is actually in the DOM.
  const restorePendingRef = useRef<EventsScrollSnapshot | null>(
    restoredScroll ?? null,
  )
  const autoScrolledDayKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (restorePendingRef.current) {
      if (!scrollRef.current && !mobileScrollRef.current) return
      const snap = restorePendingRef.current
      restorePendingRef.current = null
      autoScrolledDayKeyRef.current = dayKey
      if (snap.innerVertical != null && scrollRef.current) {
        scrollRef.current.scrollTop = snap.innerVertical
      }
      if (snap.innerHorizontal != null && mobileScrollRef.current) {
        mobileScrollRef.current.scrollLeft = snap.innerHorizontal
      }
      return
    }
    if (autoScrolledDayKeyRef.current === dayKey) return
    if (!scrollRef.current && !mobileScrollRef.current) return
    autoScrolledDayKeyRef.current = dayKey
    // When the selected day is today, anchor on the first *upcoming* event
    // (start at or after now in the popup tz) so the user lands on what's
    // next instead of the morning's already-finished sessions. Any other
    // day keeps anchoring on its earliest event.
    let anchorMin = Number.POSITIVE_INFINITY
    for (const items of columnEvents.values()) {
      for (const it of items) {
        if (isViewingToday && it.startMin < nowMin) continue
        if (it.startMin < anchorMin) anchorMin = it.startMin
        break
      }
    }
    const anchor = Number.isFinite(anchorMin)
      ? anchorMin
      : isViewingToday
        ? nowMin
        : 8 * 60
    if (scrollRef.current) {
      const target = Math.max(0, anchor * MIN_PX - HOUR_PX)
      scrollRef.current.scrollTo({ top: target, behavior: "smooth" })
    }
    if (mobileScrollRef.current) {
      const target = Math.max(0, anchor * M_MIN_W - M_HOUR_W)
      mobileScrollRef.current.scrollTo({ left: target, behavior: "smooth" })
    }
    // `isViewingToday`/`nowMin` are read for the upcoming-anchor math; the
    // once-per-day guard above keeps the minute tick from re-scrolling.
  }, [columnEvents, dayKey, isViewingToday, nowMin])

  const goPrev = () => setSelectedDate((d) => subDays(d, 1))
  const goNext = () => setSelectedDate((d) => addDays(d, 1))
  const [datePickerOpen, setDatePickerOpen] = useState(false)

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
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex flex-col items-end min-w-0">
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm font-semibold capitalize truncate hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  aria-label={t("events.day.pick_date")}
                  title={t("events.day.pick_date")}
                >
                  <span className="truncate">
                    {formatDatePickerLabel(selectedDate)}
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
                  autoFocus
                />
              </PopoverContent>
            </Popover>
            <span className="text-[11px] text-muted-foreground">
              {t("events.day.event_count", { count: totalEvents })}
              {timezone ? ` · ${timezone}` : ""}
            </span>
          </div>
          {onToggleFullscreen && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={onToggleFullscreen}
              aria-label={t(
                isFullscreen
                  ? "events.day.exit_fullscreen"
                  : "events.day.enter_fullscreen",
              )}
              title={t(
                isFullscreen
                  ? "events.day.exit_fullscreen"
                  : "events.day.enter_fullscreen",
              )}
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
          <p className="text-sm text-muted-foreground">
            {t("events.day.no_venues")}
          </p>
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
            {/* min-w-max makes the grid box span the full content width (not
              just the scroll viewport). Without it the `1fr` columns overflow
              a viewport-wide box, so the sticky-left hour column only stays
              pinned within that first viewport and scrolls away after. */}
            <div
              className="grid min-w-max"
              style={{
                gridTemplateColumns: `${HOUR_LABEL_COL}px repeat(${venueCount}, minmax(${VENUE_COL_MIN}px, ${VENUE_COL_MAX}px))`,
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
                    {isViewingToday && (
                      <div
                        className="absolute left-0 right-0 z-10 h-0.5 bg-red-500 pointer-events-none"
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
                          summarizeRrule(event.rrule, t) ??
                          (event.recurrence_master_id
                            ? t("events.list.part_of_recurring_series")
                            : null)
                        const isRsvpd =
                          !!event.my_rsvp_status &&
                          event.my_rsvp_status !== "cancelled"
                        const isHighlighted = event.highlighted === true
                        const isOwner =
                          currentHuman != null &&
                          event.owner_id === currentHuman.id
                        return (
                          <Link
                            key={event.id}
                            id={
                              event.occurrence_id
                                ? `event-card-${event.id}__${event.start_time}`
                                : `event-card-${event.id}`
                            }
                            href={eventHref(event)}
                            onClick={(e) => handleEventClick(event, e)}
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
                              {isOwner && (
                                <Crown
                                  className="h-3 w-3 shrink-0 text-amber-500"
                                  aria-label={t("events.list.owned_title")}
                                />
                              )}
                              {!event.venue_id &&
                                event.custom_location_name && (
                                  <Home
                                    className="h-3 w-3 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
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
                              <div className="flex items-center gap-1 text-[10px] font-medium text-violet-700 dark:text-violet-300 mt-0.5">
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
                            {isAuthed &&
                              !isShort &&
                              event.status === "published" &&
                              (() => {
                                const rsvpKey = `${event.id}:${event.start_time}`
                                const isRsvpPending = pendingRsvpKey === rsvpKey
                                return (
                                  <div className="absolute bottom-1 right-1">
                                    {isRsvpd ? (
                                      <button
                                        type="button"
                                        disabled={isRsvpPending}
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          cancelRsvpMutation.mutate(event)
                                        }}
                                        className="inline-flex items-center gap-0.5 rounded border border-emerald-300 bg-emerald-50 px-1 py-0.5 text-[9px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                                      >
                                        {isRsvpPending ? (
                                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                        ) : (
                                          <CheckCircle className="h-2.5 w-2.5" />
                                        )}
                                        {t("events.rsvp.going")}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={isRsvpPending}
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          rsvpMutation.mutate(event)
                                        }}
                                        className="inline-flex items-center gap-0.5 rounded border bg-background px-1 py-0.5 text-[9px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {isRsvpPending && (
                                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                        )}
                                        {t("events.rsvp.rsvp")}
                                      </button>
                                    )}
                                  </div>
                                )
                              })()}
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
            className={cn(
              "md:hidden overflow-auto",
              isFullscreen ? "max-h-[calc(100vh-9rem)]" : "max-h-[70vh]",
            )}
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
                      {isViewingToday && (
                        <div
                          className="absolute top-0 bottom-0 z-10 w-0.5 bg-red-500 pointer-events-none"
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
                        const isRsvpd =
                          !!event.my_rsvp_status &&
                          event.my_rsvp_status !== "cancelled"
                        const isHighlighted = event.highlighted === true
                        const isOwner =
                          currentHuman != null &&
                          event.owner_id === currentHuman.id
                        return (
                          <Link
                            key={event.id}
                            id={
                              event.occurrence_id
                                ? `event-card-${event.id}__${event.start_time}`
                                : `event-card-${event.id}`
                            }
                            href={eventHref(event)}
                            onClick={(e) => handleEventClick(event, e)}
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
                              {isOwner && (
                                <Crown
                                  className="h-2.5 w-2.5 shrink-0 text-amber-500"
                                  aria-hidden="true"
                                />
                              )}
                              {!event.venue_id &&
                                event.custom_location_name && (
                                  <Home
                                    className="h-2.5 w-2.5 shrink-0 text-muted-foreground"
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
                              {isAuthed && isRsvpd && (
                                <CheckCircle className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400 ml-auto shrink-0" />
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
