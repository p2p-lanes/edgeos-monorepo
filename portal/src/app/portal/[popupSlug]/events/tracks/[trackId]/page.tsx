"use client"

import { useQueries, useQuery } from "@tanstack/react-query"
import { ArrowLeft, Clock, Layers, MapPin } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useTranslation } from "react-i18next"

import {
  ApiError,
  type EventPublic,
  type EventVenuePublic,
  EventVenuesService,
  TracksService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { useCityProvider } from "@/providers/cityProvider"
import { useEventTimezone } from "../../lib/useEventTimezone"

export default function TrackDetailPage() {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()
  const params = useParams<{ trackId: string }>()
  const { timezone, formatTime, formatDateShort, formatDayKey } =
    useEventTimezone(city?.id)

  const {
    data: track,
    isLoading: trackLoading,
    error: trackError,
  } = useQuery({
    queryKey: ["portal-track", params.trackId],
    queryFn: () => TracksService.getPortalTrack({ trackId: params.trackId }),
    enabled: !!params.trackId,
    retry: (failureCount, err) => {
      if (
        err instanceof ApiError &&
        (err.status === 404 || err.status === 403)
      ) {
        return false
      }
      return failureCount < 2
    },
  })

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ["portal-track-events", params.trackId],
    queryFn: () =>
      TracksService.listPortalTrackEvents({
        trackId: params.trackId,
        limit: 200,
      }),
    enabled: !!params.trackId && !!track,
  })

  const events: EventPublic[] = eventsData?.results ?? []

  // Batch-fetch venue details for events that reference a venue, so each
  // card can show the real location (not just the event.kind placeholder).
  // Matches the pattern used on the main events list page.
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

  if (trackLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (trackError instanceof ApiError && trackError.status === 404) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center">
        <h1 className="text-lg font-semibold mb-1">
          {t("events.tracks.detail.track_not_found")}
        </h1>
        <Link
          href={`/portal/${city?.slug}/events/tracks`}
          className="inline-flex items-center gap-1 text-sm text-primary mt-4"
        >
          <ArrowLeft className="h-4 w-4" />{" "}
          {t("events.tracks.detail.back_to_tracks")}
        </Link>
      </div>
    )
  }

  if (!track) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center">
        <p className="text-muted-foreground">
          {t("events.tracks.detail.track_not_found")}
        </p>
      </div>
    )
  }

  // Group events by day in the popup timezone.
  const grouped = new Map<string, EventPublic[]>()
  for (const e of events) {
    const key = formatDayKey(e.start_time)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(e)
  }
  const groupedEntries = Array.from(grouped.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  )

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <Link
        href={`/portal/${city?.slug}/events/tracks`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />{" "}
        {t("events.tracks.detail.back_to_tracks")}
      </Link>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Layers className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">{track.name}</h1>
        </div>
        {track.description && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {track.description}
          </p>
        )}
        {track.topic && track.topic.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {track.topic.map((tag: string) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">
            {t("events.tracks.detail.heading")}
          </h2>
          {timezone && (
            <span className="text-xs text-muted-foreground">
              {t("events.tracks.detail.times_in_timezone", { timezone })}
            </span>
          )}
        </div>

        {eventsLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("events.tracks.detail.no_events")}
          </p>
        ) : (
          <div className="space-y-6">
            {groupedEntries.map(([dayKey, dayEvents]) => (
              <div key={dayKey}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {formatDateShort(dayEvents[0].start_time)}
                  </h3>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="space-y-2 pl-5 border-l-2 border-border">
                  {dayEvents.map((event) => {
                    const venue = event.venue_id
                      ? venueMap.get(event.venue_id)
                      : undefined
                    return (
                      <Link
                        key={event.id}
                        href={`/portal/${city?.slug}/events/${event.id}`}
                        className="block rounded-xl border bg-card p-3 hover:shadow-md transition-shadow"
                      >
                        <h4 className="text-sm font-medium">{event.title}</h4>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
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
                      </Link>
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
