import { dayBoundsInTz } from "@edgeos/shared-events"
import { useQuery } from "@tanstack/react-query"
import {
  CalendarDays,
  Clock,
  Filter,
  Layers,
  MapPin,
  Repeat,
  Tag,
  Users,
} from "lucide-react"
import { useEffect, useMemo, useRef } from "react"
import type { EventPublic } from "@/client"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchAllEvents } from "@/lib/events/fetchAllEvents"
import {
  type EventStatusFilter,
  resolveStatusFilter,
} from "@/lib/events/statusFilter"
import { summarizeRrule } from "@/lib/events/summarizeRrule"
import { useEventTimezone } from "@/lib/events/useEventTimezone"
import { cn } from "@/lib/utils"
import { CoverImage } from "./CoverImage"
import { EventBadges } from "./EventBadges"

interface EventsListViewProps {
  popupId: string
  status: EventStatusFilter | undefined
  venueId: string | undefined
  search: string
  popupStart?: string | null
  popupEnd?: string | null
  onEventClick: (event: EventPublic) => void
}

function groupByDate(
  events: EventPublic[],
  formatDayKey: (d: string) => string,
): [string, EventPublic[]][] {
  const groups: Record<string, EventPublic[]> = {}
  for (const event of events) {
    const key = formatDayKey(event.start_time)
    if (!groups[key]) groups[key] = []
    groups[key].push(event)
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
}

/**
 * Grouped-by-day event card list for the backoffice events page. Mirrors
 * the portal list view but in admin mode: shows ALL events (past and
 * future, every status), each with its status badge, and clicks route into
 * the event edit flow via `onEventClick` (no attendee RSVP / hide controls).
 * Times are rendered in the popup's timezone.
 */
export function EventsListView({
  popupId,
  status,
  venueId,
  search,
  popupStart,
  popupEnd,
  onEventClick,
}: EventsListViewProps) {
  const {
    formatTime,
    formatDateFull,
    formatDayKey,
    timezone,
    isLoading: tzLoading,
  } = useEventTimezone(popupId)

  // Bound to the popup's date range (in its timezone). A window makes the
  // backend expand recurring series into concrete occurrences — matching the
  // day/calendar views — instead of showing each series once at its master.
  // Falls back to no window (no expansion) when the popup has no dates.
  const listWindow = useMemo(() => {
    const startYmd = popupStart?.slice(0, 10)
    const endYmd = popupEnd?.slice(0, 10)
    if (!startYmd || !endYmd || !timezone) return null
    return {
      startAfter: dayBoundsInTz(startYmd, timezone).start.toISOString(),
      startBefore: dayBoundsInTz(endYmd, timezone).end.toISOString(),
    }
  }, [popupStart, popupEnd, timezone])

  const { data, isLoading } = useQuery({
    queryKey: [
      "events",
      "list",
      popupId,
      status,
      venueId,
      search,
      listWindow?.startAfter,
      listWindow?.startBefore,
    ],
    // Walk every page so a dense popup is never truncated at a fixed limit.
    queryFn: () =>
      fetchAllEvents({
        popupId,
        ...resolveStatusFilter(status),
        venueId:
          venueId && venueId !== "custom" && venueId !== "meeting"
            ? venueId
            : undefined,
        locationKind:
          venueId === "custom" || venueId === "meeting"
            ? (venueId as "custom" | "meeting")
            : undefined,
        search: search || undefined,
        startAfter: listWindow?.startAfter,
        startBefore: listWindow?.startBefore,
      }),
    enabled: !!popupId && !tzLoading,
  })

  // Auto-scroll to today (or the first upcoming day) once the list renders,
  // so admins land on what's current instead of the oldest past event.
  const todayAnchorRef = useRef<HTMLDivElement | null>(null)
  const didAutoScrollRef = useRef(false)
  useEffect(() => {
    if (didAutoScrollRef.current) return
    if (!data) return
    const el = todayAnchorRef.current
    if (!el) return
    didAutoScrollRef.current = true
    el.scrollIntoView({ block: "start" })
  }, [data])

  if (isLoading || tzLoading) {
    return <Skeleton className="h-64 w-full" />
  }

  const events = data ?? []

  if (events.length === 0) {
    return (
      <div className="text-center py-20">
        <Filter className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">No events match these filters</p>
      </div>
    )
  }

  const grouped = groupByDate(events, formatDayKey)
  const todayKey = formatDayKey(new Date().toISOString())
  // Anchor the auto-scroll on today, or the first day after it when today has
  // no events (keys are YYYY-MM-DD, so a string compare is chronological).
  const anchorIdx = grouped.findIndex(([date]) => date >= todayKey)

  return (
    <div className="space-y-6">
      {grouped.map(([date, dayEvents], idx) => (
        <div
          key={date}
          ref={idx === anchorIdx ? todayAnchorRef : undefined}
          className="scroll-mt-[13.5rem] sm:scroll-mt-32"
        >
          {/* Sticky day header: freezes just below the sticky search/filters
              toolbar (which itself pins under the h-16 app top bar) while its
              day is in view; the next day's header pushes it up on scroll. The
              top offset accounts for the toolbar height — taller on mobile,
              where the filters wrap onto a second row. */}
          <div className="sticky top-[13.5rem] sm:top-32 z-[5] flex items-center gap-3 bg-background py-2 mb-3">
            <div className="h-2 w-2 rounded-full bg-primary" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {formatDateFull(dayEvents[0].start_time)}
            </h2>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="space-y-2 pl-5 border-l-2 border-border">
            {dayEvents.map((event) => {
              const isHighlighted = event.highlighted === true
              const recurrenceLabel =
                summarizeRrule(event.rrule) ??
                (event.recurrence_master_id
                  ? "Part of a recurring series"
                  : null)
              const thumbUrl = event.cover_url || event.venue_image_url || null
              return (
                <div
                  key={event.id}
                  className={cn(
                    "relative rounded-xl border bg-card hover:shadow-md transition-shadow",
                    isHighlighted &&
                      "border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onEventClick(event)}
                    className="block w-full text-left p-3 sm:p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-lg overflow-hidden">
                        <CoverImage
                          src={thumbUrl}
                          alt={event.title}
                          className="w-full h-full object-cover"
                          fallback={
                            <CalendarDays className="h-5 w-5 text-muted-foreground/40" />
                          }
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3 className="font-medium text-sm sm:text-base">
                            {event.title}
                          </h3>
                          <EventBadges
                            status={event.status}
                            visibility={event.visibility}
                            showPublishedStatus
                            className="shrink-0 justify-end"
                          />
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>
                            {formatTime(event.start_time)} –{" "}
                            {formatTime(event.end_time)}
                          </span>
                        </div>
                        {event.venue_title && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                            <MapPin className="h-3 w-3" />
                            <span className="truncate">
                              {event.venue_title}
                              {event.venue_location
                                ? ` · ${event.venue_location}`
                                : ""}
                            </span>
                          </div>
                        )}
                        {recurrenceLabel && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                            <Repeat className="h-3 w-3" />
                            <span className="truncate">{recurrenceLabel}</span>
                          </div>
                        )}
                        {event.track_title && (
                          <div className="flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300 mt-0.5">
                            <Layers className="h-3 w-3" />
                            <span className="truncate">
                              {event.track_title}
                            </span>
                          </div>
                        )}
                        {event.attendee_count != null && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                            <Users className="h-3 w-3" />
                            <span>
                              {event.attendee_count}{" "}
                              {event.attendee_count === 1 ? "RSVP" : "RSVPs"}
                            </span>
                          </div>
                        )}
                        {event.tags && event.tags.length > 0 && (
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                            {event.tags.slice(0, 3).map((tag: string) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/60 text-muted-foreground"
                              >
                                <Tag className="h-2.5 w-2.5" />
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
