"use client"

import { useQueries, useQuery } from "@tanstack/react-query"
import { CalendarDays, Clock, Filter, MapPin, Pencil, Tag } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import {
  type EventPublic,
  EventsService,
  type EventVenuePublic,
  EventVenuesService,
  HumansService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { useCityProvider } from "@/providers/cityProvider"
import { CalendarBody } from "./lib/CalendarBody"
import { EventsToolbar } from "./lib/EventsToolbar"
import {
  useEventTimezone,
  usePortalEventSettings,
} from "./lib/useEventTimezone"

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

const statusColors: Record<string, string> = {
  published:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  draft: "bg-muted text-muted-foreground",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function EventsPage() {
  const { getCity } = useCityProvider()
  const city = getCity()
  const [search, setSearch] = useState("")
  const [rsvpedOnly, setRsvpedOnly] = useState(false)
  const [mineOnly, setMineOnly] = useState(false)
  const [view, setView] = useState<"list" | "calendar">("list")

  const { data: currentHuman } = useQuery({
    queryKey: ["current-human"],
    queryFn: () => HumansService.getCurrentHumanInfo(),
    staleTime: 5 * 60 * 1000,
  })
  const { timezone, formatTime, formatDateShort, formatDayKey } =
    useEventTimezone(city?.id)

  const { data: eventSettings } = usePortalEventSettings(city?.id)
  const eventsEnabled = eventSettings?.event_enabled ?? true

  const { data, isLoading } = useQuery({
    queryKey: ["portal-events", city?.id, search, rsvpedOnly, mineOnly],
    queryFn: () =>
      EventsService.listPortalEvents({
        popupId: city!.id,
        search: search || undefined,
        // When showing "My events" we want drafts / pending / rejected too;
        // otherwise restrict to what's publicly visible.
        eventStatus: mineOnly ? undefined : "published",
        rsvpedOnly: rsvpedOnly || undefined,
        limit: 200,
      }),
    enabled: !!city?.id && eventsEnabled && view === "list",
  })

  const rawEvents = data?.results ?? []
  const events = mineOnly
    ? rawEvents.filter((e) => currentHuman && e.owner_id === currentHuman.id)
    : rawEvents
  const grouped = groupByDate(events, formatDayKey)

  // Batch-fetch venue titles for events that reference a venue.
  const venueIds = Array.from(
    new Set(
      events
        .map((e) => e.venue_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  )
  const venueQueries = useQueries({
    queries: venueIds.map((venueId) => ({
      queryKey: ["portal-event-venue", venueId],
      queryFn: () => EventVenuesService.getVenue({ venueId }),
      staleTime: 5 * 60 * 1000,
    })),
  })
  const venueMap = new Map<string, EventVenuePublic>()
  venueQueries.forEach((q, idx) => {
    if (q.data) venueMap.set(venueIds[idx], q.data)
  })

  if (!eventsEnabled) {
    return (
      <div className="flex flex-col h-full max-w-4xl mx-auto p-4 sm:p-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <h1 className="text-xl font-semibold">Events are disabled</h1>
          <p className="text-sm text-muted-foreground mt-2">
            The organizer has turned off events for {city?.name}.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex-none mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Events</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upcoming events at {city?.name}
          {timezone ? ` — times shown in ${timezone}` : ""}
        </p>
      </div>

      <div className="flex-none mb-4">
        <EventsToolbar
          slug={city?.slug}
          view={view}
          onViewChange={setView}
          search={search}
          onSearchChange={setSearch}
          rsvpedOnly={rsvpedOnly}
          onRsvpedOnlyChange={setRsvpedOnly}
          mineOnly={mineOnly}
          onMineOnlyChange={setMineOnly}
          canCreate={eventSettings?.can_publish_event === "everyone"}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {view === "calendar" ? (
          <CalendarBody
            popupId={city?.id}
            slug={city?.slug}
            search={search}
            rsvpedOnly={rsvpedOnly}
          />
        ) : isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-20">
            <Filter className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No events yet</p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([date, dayEvents]) => (
              <div key={date}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {formatDateShort(dayEvents[0].start_time)}
                  </h2>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="space-y-2 pl-5 border-l-2 border-border">
                  {dayEvents.map((event) => {
                    const venue = event.venue_id
                      ? venueMap.get(event.venue_id)
                      : undefined
                    const isOwner =
                      currentHuman != null && event.owner_id === currentHuman.id
                    return (
                      <div
                        key={event.id}
                        className="relative rounded-xl border bg-card hover:shadow-md transition-shadow"
                      >
                        <Link
                          href={`/portal/${city?.slug}/events/${event.id}`}
                          className="block p-3 sm:p-4"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1 pr-8">
                            <h3 className="font-medium text-sm sm:text-base">
                              {event.title}
                            </h3>
                            <Badge
                              variant="secondary"
                              className={
                                statusColors[event.status as string] ?? ""
                              }
                            >
                              {event.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>
                              {formatTime(event.start_time)} –{" "}
                              {formatTime(event.end_time)}
                            </span>
                          </div>
                          {venue && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                              <MapPin className="h-3 w-3" />
                              <span className="truncate">
                                {venue.title}
                                {venue.location ? ` · ${venue.location}` : ""}
                              </span>
                            </div>
                          )}
                          {event.tags && event.tags.length > 0 && (
                            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                              {event.tags.slice(0, 3).map((tag: string) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center gap-0.5 text-[10px] bg-muted px-1.5 py-0.5 rounded"
                                >
                                  <Tag className="h-2.5 w-2.5" />
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </Link>
                        {isOwner && (
                          <Link
                            href={`/portal/${city?.slug}/events/${event.id}/edit`}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Edit ${event.title}`}
                            className="absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
