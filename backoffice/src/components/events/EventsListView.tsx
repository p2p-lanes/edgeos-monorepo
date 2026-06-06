import { useQuery } from "@tanstack/react-query"
import {
  CalendarDays,
  Clock,
  Filter,
  Layers,
  MapPin,
  Repeat,
  Tag,
} from "lucide-react"
import { type EventPublic, type EventStatus, EventsService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { summarizeRrule } from "@/lib/events/summarizeRrule"
import { useEventTimezone } from "@/lib/events/useEventTimezone"
import { cn } from "@/lib/utils"
import { CoverImage } from "./CoverImage"

interface EventsListViewProps {
  popupId: string
  status: EventStatus | undefined
  venueId: string | undefined
  search: string
  onEventClick: (event: EventPublic) => void
}

const statusColors: Record<string, string> = {
  published: "bg-primary/10 text-primary",
  draft: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
  pending_approval:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
}

const statusLabels: Record<string, string> = {
  published: "Public",
  draft: "Draft",
  cancelled: "Cancelled",
  pending_approval: "Pending approval",
  rejected: "Rejected",
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
  onEventClick,
}: EventsListViewProps) {
  const {
    formatTime,
    formatDateFull,
    formatDayKey,
    isLoading: tzLoading,
  } = useEventTimezone(popupId)

  const { data, isLoading } = useQuery({
    queryKey: ["events", "list", popupId, status, venueId, search],
    queryFn: () =>
      EventsService.listEvents({
        popupId,
        eventStatus: status,
        venueId:
          venueId && venueId !== "custom" && venueId !== "meeting"
            ? venueId
            : undefined,
        locationKind:
          venueId === "custom" || venueId === "meeting" ? venueId : undefined,
        search: search || undefined,
        limit: 500,
      }),
    enabled: !!popupId && !tzLoading,
  })

  if (isLoading || tzLoading) {
    return <Skeleton className="h-64 w-full" />
  }

  const events = data?.results ?? []

  if (events.length === 0) {
    return (
      <div className="text-center py-20">
        <Filter className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">No events match these filters</p>
      </div>
    )
  }

  const grouped = groupByDate(events, formatDayKey)

  return (
    <div className="space-y-6">
      {grouped.map(([date, dayEvents]) => (
        <div key={date}>
          <div className="flex items-center gap-3 mb-3">
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
                          <Badge
                            variant="secondary"
                            className={
                              statusColors[event.status as string] ?? ""
                            }
                          >
                            {statusLabels[event.status as string] ??
                              event.status}
                          </Badge>
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
