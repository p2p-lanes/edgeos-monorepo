"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CalendarDays,
  CheckCircle,
  Clock,
  Eye,
  EyeOff,
  Filter,
  MapPin,
  Pencil,
  Repeat,
  Tag,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import {
  EventParticipantsService,
  type EventPublic,
  EventsService,
  HumansService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { useCityProvider } from "@/providers/cityProvider"
import { CalendarBody } from "./lib/CalendarBody"
import { EventsToolbar } from "./lib/EventsToolbar"
import { summarizeRrule } from "./lib/summarizeRrule"
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
  const [showHidden, setShowHidden] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [view, setView] = useState<"list" | "calendar">("list")
  const queryClient = useQueryClient()

  const { data: currentHuman } = useQuery({
    queryKey: ["current-human"],
    queryFn: () => HumansService.getCurrentHumanInfo(),
    staleTime: 5 * 60 * 1000,
  })
  const { timezone, formatTime, formatDateShort, formatDayKey } =
    useEventTimezone(city?.id)

  const { data: eventSettings } = usePortalEventSettings(city?.id)
  const eventsEnabled = eventSettings?.event_enabled ?? true

  // Expansion window for recurring events. Passing start_after triggers the
  // backend to expand RRULEs into concrete occurrences; without it, recurring
  // events render only at their master's start (hiding the other instances
  // from the list while the calendar still showed them).
  const listWindow = useState(() => {
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 180)
    return {
      startAfter: start.toISOString(),
      startBefore: end.toISOString(),
    }
  })[0]

  const { data, isLoading } = useQuery({
    queryKey: [
      "portal-events",
      city?.id,
      search,
      rsvpedOnly,
      mineOnly,
      showHidden,
      selectedTags,
      listWindow.startAfter,
      listWindow.startBefore,
    ],
    queryFn: () =>
      EventsService.listPortalEvents({
        popupId: city!.id,
        search: search || undefined,
        // When showing "My events" we want drafts / pending / rejected too;
        // otherwise restrict to what's publicly visible.
        eventStatus: mineOnly ? undefined : "published",
        rsvpedOnly: rsvpedOnly || undefined,
        includeHidden: showHidden || undefined,
        tags: selectedTags.length ? selectedTags : undefined,
        startAfter: listWindow.startAfter,
        startBefore: listWindow.startBefore,
        limit: 200,
      }),
    enabled: !!city?.id && eventsEnabled && view === "list",
  })

  const { data: hiddenCountData } = useQuery({
    queryKey: ["portal-events-hidden-count", city?.id],
    queryFn: () => EventsService.portalHiddenEventsCount({ popupId: city!.id }),
    enabled: !!city?.id && eventsEnabled,
    staleTime: 30 * 1000,
  })

  const rsvpMutation = useMutation({
    mutationFn: (eventId: string) =>
      EventParticipantsService.registerForEvent({ eventId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
    },
  })
  const cancelRsvpMutation = useMutation({
    mutationFn: (eventId: string) =>
      EventParticipantsService.cancelRegistration({ eventId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
    },
  })

  const hideMutation = useMutation({
    mutationFn: (eventId: string) => EventsService.hidePortalEvent({ eventId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
      queryClient.invalidateQueries({
        queryKey: ["portal-events-hidden-count"],
      })
    },
  })
  const unhideMutation = useMutation({
    mutationFn: (eventId: string) =>
      EventsService.unhidePortalEvent({ eventId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
      queryClient.invalidateQueries({
        queryKey: ["portal-events-hidden-count"],
      })
    },
  })

  const rawEvents = data?.results ?? []
  const events = mineOnly
    ? rawEvents.filter((e) => currentHuman && e.owner_id === currentHuman.id)
    : rawEvents
  const grouped = groupByDate(events, formatDayKey)

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
          showHidden={showHidden}
          onShowHiddenChange={setShowHidden}
          hiddenCount={hiddenCountData?.count}
          allowedTags={eventSettings?.allowed_tags ?? []}
          selectedTags={selectedTags}
          onSelectedTagsChange={setSelectedTags}
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
            tags={selectedTags}
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
                    const isOwner =
                      currentHuman != null && event.owner_id === currentHuman.id
                    const isHidden = event.hidden === true
                    return (
                      <div
                        key={event.id}
                        className={
                          isHidden
                            ? "relative rounded-xl border bg-card opacity-60 hover:opacity-100 transition-opacity"
                            : "relative rounded-xl border bg-card hover:shadow-md transition-shadow"
                        }
                      >
                        <Link
                          href={`/portal/${city?.slug}/events/${event.id}`}
                          className="block p-3 sm:p-4 pb-11"
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
                          {(event.rrule || event.recurrence_master_id) && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                              <Repeat className="h-3 w-3" />
                              <span className="truncate">
                                {summarizeRrule(event.rrule) ??
                                  "Part of a recurring series"}
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
                        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                          {event.status === "published" &&
                            (event.my_rsvp_status &&
                            event.my_rsvp_status !== "cancelled" ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  cancelRsvpMutation.mutate(event.id)
                                }}
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 text-xs font-medium text-primary hover:bg-primary/20"
                              >
                                <CheckCircle className="h-3 w-3" />
                                Going
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  rsvpMutation.mutate(event.id)
                                }}
                                className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs font-medium shadow-sm hover:bg-muted"
                              >
                                RSVP
                              </button>
                            ))}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              if (isHidden) unhideMutation.mutate(event.id)
                              else hideMutation.mutate(event.id)
                            }}
                            aria-label={
                              isHidden
                                ? `Unhide ${event.title}`
                                : `Hide ${event.title}`
                            }
                            title={isHidden ? "Unhide" : "Hide from my list"}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                          >
                            {isHidden ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {isOwner && (
                            <Link
                              href={`/portal/${city?.slug}/events/${event.id}/edit`}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Edit ${event.title}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Link>
                          )}
                        </div>
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
