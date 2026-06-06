"use client"

import { useQuery } from "@tanstack/react-query"

import { EVENTS_QUERY_LIMIT } from "@/app/portal/[popupSlug]/events/lib/eventsQuery"
import { type EventPublicCalendarResponse, EventsService } from "@/client"

interface UsePublicCalendarEventsArgs {
  popupSlug: string
  tenantId?: string | null
  startAfter?: string | null
  startBefore?: string | null
  search?: string
  tags?: string[]
  trackIds?: string[]
}

/**
 * Anonymous fetch of the public calendar feed for a popup. The endpoint
 * resolves its tenant from Origin/Referer/X-Tenant-Id; we still forward
 * the resolved ``tenantId`` from ``useTenant()`` so the request works in
 * environments where the browser strips Origin (older mobile webviews,
 * custom-domain reverse proxies).
 */
export function usePublicCalendarEvents({
  popupSlug,
  tenantId,
  startAfter,
  startBefore,
  search,
  tags,
  trackIds,
}: UsePublicCalendarEventsArgs) {
  return useQuery<EventPublicCalendarResponse>({
    queryKey: [
      "public-calendar",
      popupSlug,
      tenantId,
      startAfter,
      startBefore,
      search,
      tags,
      trackIds,
    ],
    queryFn: () =>
      EventsService.listPublicCalendar({
        popupSlug,
        xTenantId: tenantId ?? undefined,
        startAfter: startAfter ?? undefined,
        startBefore: startBefore ?? undefined,
        search: search || undefined,
        tags: tags?.length ? tags : undefined,
        trackIds: trackIds?.length ? trackIds : undefined,
        limit: EVENTS_QUERY_LIMIT,
      }),
    enabled: !!popupSlug && !!tenantId,
    staleTime: 60 * 1000,
  })
}
