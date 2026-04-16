"use client"

import { useQuery } from "@tanstack/react-query"

import { type EventVenuePublic, EventVenuesService } from "@/client"

/**
 * Fetch a single venue by id. Returns null when no id is provided.
 */
export function useVenue(venueId: string | null | undefined) {
  return useQuery<EventVenuePublic | null>({
    queryKey: ["portal-event-venue", venueId],
    queryFn: async () => {
      if (!venueId) return null
      return EventVenuesService.getVenue({ venueId })
    },
    enabled: !!venueId,
    staleTime: 5 * 60 * 1000,
  })
}
