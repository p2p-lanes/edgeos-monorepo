import { type EventPublic, type EventStatus, EventsService } from "@/client"

/** Page size for the paginated events fetch loop. */
const PAGE = 100

export interface FetchAllEventsParams {
  popupId: string
  /** Omit for all statuses (backoffice default). */
  eventStatus?: EventStatus
  venueId?: string
  locationKind?: "custom" | "meeting"
  startAfter?: string
  startBefore?: string
  search?: string
}

/**
 * Fetches EVERY event matching the window/filters across all pages, sorted
 * ascending by ``start_time``.
 *
 * The backend paginates DB rows first, THEN expands recurring occurrences
 * within each page and sorts only within that page. So a single capped request
 * silently truncates a dense window (the bug behind the calendar showing fewer
 * events than the list/day). We walk every page — ``paging.total`` counts DB
 * rows, so we loop while ``skip < total`` — and re-sort the merged set.
 *
 * Passing ``startAfter``/``startBefore`` also triggers the backend to expand
 * recurring series into concrete occurrences inside the window; without a
 * window, recurring events render only at their master's start.
 */
export async function fetchAllEvents(
  params: FetchAllEventsParams,
): Promise<EventPublic[]> {
  const all: EventPublic[] = []
  let skip = 0
  let total = Number.POSITIVE_INFINITY

  while (skip < total) {
    const { results, paging } = await EventsService.listEvents({
      popupId: params.popupId,
      eventStatus: params.eventStatus,
      venueId: params.venueId,
      locationKind: params.locationKind,
      startAfter: params.startAfter,
      startBefore: params.startBefore,
      search: params.search,
      limit: PAGE,
      skip,
    })
    all.push(...results)
    total = paging.total
    skip += PAGE
  }

  return all.sort((a, b) => a.start_time.localeCompare(b.start_time))
}
