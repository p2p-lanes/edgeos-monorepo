import { useQueries } from "@tanstack/react-query"
import { useMemo } from "react"
import { EventsService, EventVenuesService } from "@/client"
import useGroupMapping from "./useGroupMapping"

// Static children of `/events` that must NOT be treated as event IDs.
const STATIC_EVENT_CHILDREN = new Set(["calendar", "new", "venues"])
const STATIC_VENUE_CHILDREN = new Set(["new"])

interface DetectedIds {
  eventId: string | null
  venueId: string | null
}

const detectIds = (pathSegments: string[]): DetectedIds => {
  const empty: DetectedIds = { eventId: null, venueId: null }
  if (pathSegments[0] !== "events") return empty

  const second = pathSegments[1]
  if (!second) return empty

  if (second === "venues") {
    const third = pathSegments[2]
    return {
      ...empty,
      venueId: third && !STATIC_VENUE_CHILDREN.has(third) ? third : null,
    }
  }

  if (STATIC_EVENT_CHILDREN.has(second)) return empty

  return { ...empty, eventId: second }
}

const useBreadcrumbNameMapping = (
  pathSegments: string[],
  popupId: string | undefined,
) => {
  const { groupMapping, isLoading: groupsLoading } = useGroupMapping()
  const { eventId, venueId } = useMemo(
    () => detectIds(pathSegments),
    [pathSegments],
  )

  const [eventQuery, venueQuery] = useQueries({
    queries: [
      {
        queryKey: ["breadcrumb-event-name", eventId],
        queryFn: () =>
          EventsService.getPortalEvent({ eventId: eventId as string }),
        enabled: !!eventId,
        staleTime: 5 * 60 * 1000,
      },
      // No single-venue portal endpoint exists, so we share the same key
      // and request shape as the venue list/detail page to hit the cache
      // when the user navigates from there.
      {
        queryKey: ["portal-event-venues", popupId],
        queryFn: () =>
          EventVenuesService.listPortalVenues({
            popupId: popupId as string,
            limit: 200,
          }),
        enabled: !!venueId && !!popupId,
        staleTime: 5 * 60 * 1000,
      },
    ],
  })

  const nameMapping = useMemo(() => {
    const result: Record<string, string> = { ...groupMapping }
    // Insert empty placeholders while a fetch is in flight so the breadcrumb
    // segment recognises the path as a known ID and renders the spinner
    // branch (instead of falling through to the raw UUID).
    if (eventId) {
      if (eventQuery.data) result[eventId] = eventQuery.data.title
      else if (eventQuery.isLoading) result[eventId] = ""
    }
    if (venueId) {
      if (venueQuery.data) {
        const match = venueQuery.data.results.find((v) => v.id === venueId)
        if (match) result[venueId] = match.title
        else result[venueId] = ""
      } else if (venueQuery.isLoading) result[venueId] = ""
    }
    return result
  }, [
    groupMapping,
    eventId,
    eventQuery.data,
    eventQuery.isLoading,
    venueId,
    venueQuery.data,
    venueQuery.isLoading,
  ])

  const isLoading =
    groupsLoading ||
    (!!eventId && eventQuery.isLoading) ||
    (!!venueId && venueQuery.isLoading)

  return { nameMapping, isLoading }
}

export default useBreadcrumbNameMapping
