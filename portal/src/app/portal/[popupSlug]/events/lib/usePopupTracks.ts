"use client"

import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { EventsService, type TrackPublic, TracksService } from "@/client"

export interface TrackWithEventCount extends TrackPublic {
  /** Distinct published events that belong to this track. */
  eventCount: number
}

/**
 * Tracks for a popup, annotated with how many published events actually
 * belong to each — and filtered down to only the tracks that have at
 * least one event (past or upcoming).
 *
 * The portal track *filter* and the portal Tracks *section* both read
 * from here so users never see a track that resolves to nothing (the
 * curated track list often contains tracks no published event uses yet).
 *
 * Presence is derived from a single broad pull of the popup's published
 * events across its whole history — deliberately *not* windowed to the
 * upcoming range, so a track whose events are all in the past still shows
 * up. Counts distinct event ids so recurring occurrences don't inflate
 * the per-track number.
 */
export function usePopupTracks(popupId: string | undefined) {
  const tracksQuery = useQuery({
    queryKey: ["portal-tracks", popupId],
    queryFn: () =>
      TracksService.listPortalTracks({
        popupId: popupId as string,
        limit: 200,
      }),
    enabled: !!popupId,
    staleTime: 5 * 60 * 1000,
  })

  const eventsQuery = useQuery({
    queryKey: ["portal-track-event-counts", popupId],
    queryFn: () =>
      EventsService.listPortalEvents({
        popupId: popupId as string,
        eventStatus: "published",
        limit: 200,
      }),
    enabled: !!popupId,
    staleTime: 5 * 60 * 1000,
  })

  const countsByTrack = useMemo(() => {
    const distinctIds = new Map<string, Set<string>>()
    for (const event of eventsQuery.data?.results ?? []) {
      if (!event.track_id) continue
      let ids = distinctIds.get(event.track_id)
      if (!ids) {
        ids = new Set()
        distinctIds.set(event.track_id, ids)
      }
      ids.add(event.id)
    }
    const counts = new Map<string, number>()
    for (const [trackId, ids] of distinctIds) counts.set(trackId, ids.size)
    return counts
  }, [eventsQuery.data])

  const tracksWithEvents = useMemo<TrackWithEventCount[]>(() => {
    const all = tracksQuery.data?.results ?? []
    return all
      .filter((track) => (countsByTrack.get(track.id) ?? 0) > 0)
      .map((track) => ({
        ...track,
        eventCount: countsByTrack.get(track.id) ?? 0,
      }))
  }, [tracksQuery.data, countsByTrack])

  return {
    tracksWithEvents,
    isLoading: tracksQuery.isLoading || eventsQuery.isLoading,
  }
}
