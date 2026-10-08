"use client"

import { useQuery } from "@tanstack/react-query"

import { type EventPublicCalendarResponse, EventsService } from "@/client"

export interface UsePublicCalendarEventsArgs {
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
      fetchAllPublicCalendarEvents({
        popupSlug,
        tenantId,
        startAfter,
        startBefore,
        search,
        tags,
        trackIds,
      }),
    enabled: !!popupSlug && !!tenantId,
    staleTime: 60 * 1000,
  })
}

/** Fetch every occurrence so a busy popup's last day is never truncated. */
export async function fetchAllPublicCalendarEvents({
  popupSlug,
  tenantId,
  startAfter,
  startBefore,
  search,
  tags,
  trackIds,
}: UsePublicCalendarEventsArgs): Promise<EventPublicCalendarResponse> {
  const limit = 200
  let skip = 0
  let response: EventPublicCalendarResponse
  const results: EventPublicCalendarResponse["results"] = []
  do {
    response = await EventsService.listPublicCalendar({
      popupSlug,
      xTenantId: tenantId ?? undefined,
      startAfter: startAfter ?? undefined,
      startBefore: startBefore ?? undefined,
      search: search || undefined,
      tags: tags?.length ? tags : undefined,
      trackIds: trackIds?.length ? trackIds : undefined,
      skip,
      limit,
    })
    results.push(...response.results)
    skip += response.results.length
  } while (response.results.length > 0 && skip < response.paging.total)
  return { ...response, results }
}
