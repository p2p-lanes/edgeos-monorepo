import { type EventPublic, EventsService } from "@/client"

/**
 * Filters accepted by {@link fetchAllPortalEvents}. Mirrors the subset of
 * ``listPortalEvents`` params the calendar/day callers need.
 */
export interface FetchAllPortalEventsParams {
  popupId: string
  eventStatus?: "published"
  startAfter?: string
  startBefore?: string
  search?: string
  tags?: string[]
  trackIds?: string[]
  venueIds?: string[]
  rsvpedOnly?: boolean
  managedOnly?: boolean
  includeHidden?: boolean
}

/**
 * Fetches EVERY portal event matching the given window/filters and returns them
 * sorted ascending by ``start_time``.
 *
 * The backend returns the full window in one unpaginated response, with
 * recurring occurrences already expanded over the complete set. We dedupe by
 * ``id + start_time`` as a safety net (a recurring occurrence and its master
 * share an id but differ by start_time) and re-sort to guarantee a stable,
 * globally ordered list regardless of backend ordering.
 */
export async function fetchAllPortalEvents(
  params: FetchAllPortalEventsParams,
): Promise<EventPublic[]> {
  const { results } = await EventsService.listPortalEvents({
    popupId: params.popupId,
    eventStatus: params.eventStatus,
    startAfter: params.startAfter,
    startBefore: params.startBefore,
    rsvpedOnly: params.rsvpedOnly,
    managedOnly: params.managedOnly,
    includeHidden: params.includeHidden,
    search: params.search,
    tags: params.tags,
    trackIds: params.trackIds,
    venueIds: params.venueIds,
  })

  const byKey = new Map<string, EventPublic>()
  for (const e of results) {
    byKey.set(`${e.id}:${e.start_time}`, e)
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.start_time.localeCompare(b.start_time),
  )
}
