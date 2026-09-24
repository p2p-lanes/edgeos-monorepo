"use client"

// Side-effect import: this route renders outside the portal layout's
// <Providers> tree, so i18next is never initialized otherwise and every
// t("...") call would render the literal key. (Same rationale as the
// sibling public calendar client.)
import "@/i18n/config"

import { CalendarDays, Clock, MapPin, Radio } from "lucide-react"
import { notFound } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { CoverImage } from "@/app/portal/[popupSlug]/events/lib/CoverImage"
import { useEventTimezone } from "@/app/portal/[popupSlug]/events/lib/useEventTimezone"
import { ApiError, type EventPublicCalendarItem } from "@/client"
import { useTenant } from "@/providers/tenantProvider"
import { usePublicCalendarEvents } from "../usePublicCalendarEvents"
import { useViewport } from "./useViewport"

// How often we re-run the "scroll to the most contemporaneous event" pass.
// The user asked for a 15-minute cadence so the board keeps drifting toward
// whatever is happening *now* on a screen nobody is touching.
const AUTOSCROLL_INTERVAL_MS = 15 * 60 * 1000
// The wall clock used for highlighting / "happening now" ticks once a minute.
const CLOCK_TICK_MS = 60 * 1000

interface TvCalendarClientProps {
  popupSlug: string
}

/** Stable per-occurrence key (matches the DOM id we scroll to). */
function eventKey(e: EventPublicCalendarItem): string {
  return e.occurrence_id ? `${e.id}__${e.start_time}` : e.id
}

/**
 * Big-screen public calendar. Reuses the same anonymous feed as
 * ``/calendar`` but draws it as a read-only, auto-scrolling, multi-column
 * board sized to whatever ``Hi Browser`` (or any TV browser) reports as its
 * view field. No clicks, no RSVP — it's an ambient display.
 */
export function TvCalendarClient({ popupSlug }: TvCalendarClientProps) {
  const { t } = useTranslation()
  const { tenantId } = useTenant()
  const viewport = useViewport()

  // Live wall clock. Drives "happening now" highlighting and the choice of
  // which event the board should be parked on.
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Same 180-day window the standard public calendar uses, padded a day on
  // each side of the UTC window so events near the popup's local-day
  // boundary are never dropped.
  const window180 = useMemo(() => {
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    start.setUTCDate(start.getUTCDate() - 1)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 182)
    return {
      startAfter: start.toISOString(),
      startBefore: end.toISOString(),
    }
  }, [])

  const query = usePublicCalendarEvents({
    popupSlug,
    tenantId,
    startAfter: window180.startAfter,
    startBefore: window180.startBefore,
  })

  // A 404 means the slug doesn't exist or doesn't belong to this tenant.
  if (query.error instanceof ApiError && query.error.status === 404) {
    notFound()
  }

  const meta = query.data?.meta
  const timezone = meta?.timezone

  const { formatTime, formatDayKey, formatDateFull } = useEventTimezone(
    meta?.popup_id,
    timezone,
  )

  // Patch the document title once the popup name is known (server-side
  // metadata can't reach the anonymous "popup by slug" endpoint).
  useEffect(() => {
    if (typeof document === "undefined") return
    document.title = meta?.popup_name
      ? t("events.public_calendar.tv.page_title", {
          popupName: meta.popup_name,
        })
      : t("events.public_calendar.tv.page_title_fallback")
  }, [meta?.popup_name, t])

  // Trim the padded window to events that start today or later in popup
  // time, then sort chronologically. Day-keys are YYYY-MM-DD, so string
  // comparison is chronological.
  const events = useMemo<EventPublicCalendarItem[]>(() => {
    const rows = query.data?.results ?? []
    const todayKey = timezone ? formatDayKey(new Date().toISOString()) : null
    const visible = todayKey
      ? rows.filter((r) => formatDayKey(r.start_time) >= todayKey)
      : rows
    return [...visible].sort((a, b) =>
      a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0,
    )
  }, [query.data, timezone, formatDayKey])

  // Group sorted events by popup-local day.
  const days = useMemo(() => {
    const groups = new Map<string, EventPublicCalendarItem[]>()
    for (const e of events) {
      const key = timezone
        ? formatDayKey(e.start_time)
        : e.start_time.slice(0, 10)
      const bucket = groups.get(key)
      if (bucket) bucket.push(e)
      else groups.set(key, [e])
    }
    return Array.from(groups, ([dayKey, dayEvents]) => ({ dayKey, dayEvents }))
  }, [events, timezone, formatDayKey])

  // Distribute day groups round-robin into the measured number of columns.
  // Round-robin (not split-in-half) keeps adjacent days side by side, so
  // parking the board on "today" also reveals the next day in the column
  // beside it — more of the schedule visible at the current moment.
  const columns = useMemo(() => {
    const count = viewport.columns
    const buckets: {
      dayKey: string
      dayEvents: EventPublicCalendarItem[]
    }[][] = Array.from({ length: count }, () => [])
    days.forEach((day, i) => {
      buckets[i % count].push(day)
    })
    return buckets
  }, [days, viewport.columns])

  // The "most contemporaneous" event: the first one still running or yet to
  // start (end_time in the future), else the very last event so a finished
  // schedule parks on its tail rather than the top.
  const currentEventKey = useMemo(() => {
    if (events.length === 0) return null
    const nowMs = now.getTime()
    const live = events.find((e) => new Date(e.end_time).getTime() >= nowMs)
    return eventKey(live ?? events[events.length - 1])
  }, [events, now])

  const isHappeningNow = (e: EventPublicCalendarItem) => {
    const nowMs = now.getTime()
    return (
      new Date(e.start_time).getTime() <= nowMs &&
      new Date(e.end_time).getTime() >= nowMs
    )
  }

  // Auto-scroll pass: park the board on the current event, then repeat every
  // 15 minutes so the display keeps drifting forward with the day. Re-armed
  // whenever the target event changes (e.g. one finishes and the next
  // becomes current) so it never lags a full interval behind.
  const scrollRootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!currentEventKey) return
    const scrollToCurrent = () => {
      const el = document.getElementById(`tv-event-${currentEventKey}`)
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
    }
    // Defer the first scroll a tick so freshly-rendered cards are laid out.
    const initial = setTimeout(scrollToCurrent, 400)
    const interval = setInterval(scrollToCurrent, AUTOSCROLL_INTERVAL_MS)
    return () => {
      clearTimeout(initial)
      clearInterval(interval)
    }
  }, [currentEventKey])

  const showLoading = query.isLoading
  const showError = query.isError && !showLoading
  const showEmpty = !showLoading && !showError && events.length === 0

  // Drive typography off the measured viewport so text is legible from a
  // couch. ``--tv-scale`` feeds the rem-based sizes below.
  const rootStyle = { ["--tv-scale" as string]: String(viewport.scale) }

  return (
    <div
      ref={scrollRootRef}
      style={rootStyle}
      className="min-h-screen bg-background text-foreground"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-background/95 px-[calc(1.5rem*var(--tv-scale))] py-[calc(1rem*var(--tv-scale))] backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-[calc(1.75rem*var(--tv-scale))] font-bold tracking-tight">
            {meta?.popup_name
              ? t("events.public_calendar.tv.heading", {
                  popupName: meta.popup_name,
                })
              : t("events.public_calendar.heading")}
          </h1>
          {timezone ? (
            <p className="text-[calc(0.95rem*var(--tv-scale))] text-muted-foreground">
              {t("events.public_calendar.tv.timezone_note", { timezone })}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-full border bg-card px-[calc(1rem*var(--tv-scale))] py-[calc(0.5rem*var(--tv-scale))]">
          <Clock className="h-[calc(1.25rem*var(--tv-scale))] w-[calc(1.25rem*var(--tv-scale))] text-primary" />
          <span className="font-mono text-[calc(1.5rem*var(--tv-scale))] font-semibold tabular-nums">
            {timezone ? formatTime(now.toISOString()) : ""}
          </span>
        </div>
      </header>

      <main className="px-[calc(1.5rem*var(--tv-scale))] py-[calc(1.5rem*var(--tv-scale))]">
        {showLoading ? (
          <div className="flex items-center justify-center py-40">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : showError ? (
          <div className="py-40 text-center">
            <CalendarDays className="mx-auto mb-4 h-16 w-16 text-muted-foreground/40" />
            <p className="text-[calc(1.25rem*var(--tv-scale))] text-muted-foreground">
              {t("events.list.empty_state")}
            </p>
          </div>
        ) : showEmpty ? (
          <div className="py-40 text-center">
            <CalendarDays className="mx-auto mb-4 h-16 w-16 text-muted-foreground/40" />
            <p className="text-[calc(1.25rem*var(--tv-scale))] text-muted-foreground">
              {t("events.list.empty_state")}
            </p>
          </div>
        ) : (
          <div
            className="grid items-start gap-[calc(1.5rem*var(--tv-scale))]"
            style={{
              gridTemplateColumns: `repeat(${viewport.columns}, minmax(0, 1fr))`,
            }}
          >
            {columns.map((column, colIndex) => (
              <div
                // Column index is a stable position, not reorderable.
                key={`col-${colIndex}`}
                className="flex flex-col gap-[calc(1.5rem*var(--tv-scale))]"
              >
                {column.map(({ dayKey, dayEvents }) => (
                  <section key={dayKey}>
                    <h2 className="mb-[calc(0.75rem*var(--tv-scale))] flex items-center gap-2 text-[calc(1.1rem*var(--tv-scale))] font-semibold uppercase tracking-wide text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                      {timezone
                        ? formatDateFull(dayEvents[0].start_time)
                        : dayKey}
                    </h2>
                    <div className="flex flex-col gap-[calc(0.75rem*var(--tv-scale))]">
                      {dayEvents.map((event) => {
                        const live = isHappeningNow(event)
                        const thumbUrl =
                          event.cover_url ||
                          event.venue_image_url ||
                          meta?.placeholder_url ||
                          null
                        return (
                          <article
                            key={eventKey(event)}
                            id={`tv-event-${eventKey(event)}`}
                            className={
                              live
                                ? "relative scroll-mt-28 rounded-2xl border-2 border-primary bg-primary/5 p-[calc(1rem*var(--tv-scale))] shadow-lg"
                                : event.highlighted
                                  ? "relative scroll-mt-28 rounded-2xl border-2 border-amber-400 bg-amber-50 p-[calc(1rem*var(--tv-scale))] dark:bg-amber-950/30"
                                  : "relative scroll-mt-28 rounded-2xl border bg-card p-[calc(1rem*var(--tv-scale))]"
                            }
                          >
                            {live ? (
                              <span className="absolute right-[calc(1rem*var(--tv-scale))] top-[calc(1rem*var(--tv-scale))] inline-flex items-center gap-1.5 rounded-full bg-primary px-[calc(0.75rem*var(--tv-scale))] py-1 text-[calc(0.8rem*var(--tv-scale))] font-semibold text-primary-foreground">
                                <Radio className="h-[calc(0.9rem*var(--tv-scale))] w-[calc(0.9rem*var(--tv-scale))] animate-pulse" />
                                {t("events.public_calendar.tv.happening_now")}
                              </span>
                            ) : null}
                            <div className="flex items-start gap-[calc(1rem*var(--tv-scale))]">
                              <div className="h-[calc(5rem*var(--tv-scale))] w-[calc(5rem*var(--tv-scale))] shrink-0 overflow-hidden rounded-xl">
                                <CoverImage
                                  src={thumbUrl}
                                  alt={event.title}
                                  className="h-full w-full object-cover"
                                  fallback={
                                    <CalendarDays className="h-7 w-7 text-muted-foreground/40" />
                                  }
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <h3 className="pr-[calc(6rem*var(--tv-scale))] text-[calc(1.35rem*var(--tv-scale))] font-semibold leading-tight">
                                  {event.title}
                                </h3>
                                <div className="mt-1.5 flex items-center gap-1.5 text-[calc(1.05rem*var(--tv-scale))] text-muted-foreground">
                                  <Clock className="h-[calc(1.05rem*var(--tv-scale))] w-[calc(1.05rem*var(--tv-scale))]" />
                                  <span className="tabular-nums">
                                    {formatTime(event.start_time)} –{" "}
                                    {formatTime(event.end_time)}
                                  </span>
                                </div>
                                {event.venue_title ||
                                event.custom_location_name ? (
                                  <div className="mt-0.5 flex items-center gap-1.5 text-[calc(1rem*var(--tv-scale))] text-muted-foreground">
                                    <MapPin className="h-[calc(1rem*var(--tv-scale))] w-[calc(1rem*var(--tv-scale))]" />
                                    <span className="truncate">
                                      {event.venue_title ||
                                        event.custom_location_name}
                                      {event.venue_location
                                        ? ` · ${event.venue_location}`
                                        : ""}
                                    </span>
                                  </div>
                                ) : null}
                                {event.track_title ? (
                                  <div className="mt-1 inline-flex rounded-md bg-violet-100 px-2 py-0.5 text-[calc(0.85rem*var(--tv-scale))] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                                    {event.track_title}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
