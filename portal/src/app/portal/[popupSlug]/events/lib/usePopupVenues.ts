"use client"

import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { EventsService } from "@/client"

export interface VenueWithEventCount {
  id: string
  name: string
  /** Distinct published events hosted at this venue. */
  eventCount: number
}

/**
 * Venues for a popup that actually host at least one published event,
 * annotated with the count. Backs the portal venue filter so users never
 * see a venue that resolves to an empty calendar.
 *
 * Presence, label, and count all come from a single server-side aggregation
 * over the popup's published events across its whole history (the
 * venue-counts endpoint joins the venue title), so the filter needs no
 * separate venues-list query and isn't capped by a page limit.
 */
export function usePopupVenues(popupId: string | undefined) {
  const countsQuery = useQuery({
    queryKey: ["portal-venue-event-counts", popupId],
    queryFn: () =>
      EventsService.listPortalVenueEventCounts({
        popupId: popupId as string,
      }),
    enabled: !!popupId,
    staleTime: 5 * 60 * 1000,
  })

  const venuesWithEvents = useMemo<VenueWithEventCount[]>(
    () =>
      (countsQuery.data ?? []).map((row) => ({
        id: row.venue_id,
        name: row.venue_title,
        eventCount: row.event_count,
      })),
    [countsQuery.data],
  )

  return {
    venuesWithEvents,
    isLoading: countsQuery.isLoading,
  }
}
