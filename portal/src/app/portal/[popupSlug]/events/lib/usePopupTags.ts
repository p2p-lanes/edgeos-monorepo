"use client"

import { useQuery } from "@tanstack/react-query"

import { EventsService } from "@/client"

/**
 * Distinct event tags actually used by events in the popup — populates
 * the authenticated portal events toolbar's tag filter so users can
 * filter by tags that exist on real events, not just the curated
 * ``event_settings.allowed_tags`` list.
 */
export function usePopupTags(popupId: string | undefined) {
  return useQuery({
    queryKey: ["portal-popup-tags", popupId],
    queryFn: () =>
      EventsService.listPortalPopupTags({ popupId: popupId as string }),
    enabled: !!popupId,
    staleTime: 5 * 60 * 1000,
  })
}
