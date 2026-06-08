import { type EventPublic, EventsService } from "@/client"

/** Page size for the paginated portal-events fetch loop. */
const PAGE = 100

/**
 * Filters accepted by {@link fetchAllPortalEvents}. Mirrors the subset of
 * ``listPortalEvents`` params the calendar/day callers need — no ``limit`` or
 * ``skip``, since the loop owns pagination.
 */
export interface FetchAllPortalEventsParams {
  popupId: string
  eventStatus?: "published"
  startAfter?: string
  startBefore?: string
  search?: string
  tags?: string[]
  trackIds?: string[]
  rsvpedOnly?: boolean
  managedOnly?: boolean
}

/**
 * Fetches EVERY portal event matching the given window/filters, across all
 * pages, and returns them sorted ascending by ``start_time``.
 *
 * Why the loop + merge + re-sort: the backend paginates over DB rows first,
 * THEN expands recurring occurrences within each page and sorts only within
 * that page. So a single capped request silently truncates, and even an
 * uncapped page is only locally ordered. To get a correct, complete, globally
 * ordered list we must walk every page (``paging.total`` counts DB rows, so we
 * loop while ``skip < total``) and re-sort the merged set client-side.
 */
export async function fetchAllPortalEvents(
  params: FetchAllPortalEventsParams,
): Promise<EventPublic[]> {
  const all: EventPublic[] = []
  let skip = 0
  // `paging.total` is the pre-pagination DB-row count. We advance `skip` by PAGE
  // (in DB-row units) until we've walked every row. We must NOT stop on an empty
  // page: a middle page can legitimately filter down to zero (hidden /
  // visibility / recurring masters with no occurrence in the window) while later
  // pages still hold events, so the DB-row total is the only reliable stop.
  let total = Number.POSITIVE_INFINITY

  while (skip < total) {
    const { results, paging } = await EventsService.listPortalEvents({
      popupId: params.popupId,
      eventStatus: params.eventStatus,
      startAfter: params.startAfter,
      startBefore: params.startBefore,
      rsvpedOnly: params.rsvpedOnly,
      managedOnly: params.managedOnly,
      search: params.search,
      tags: params.tags,
      trackIds: params.trackIds,
      limit: PAGE,
      skip,
    })
    all.push(...results)
    total = paging.total
    skip += PAGE
  }

  // `paging.total` counts DB rows but recurring expansion can yield more rows
  // per page, so the merged set is only locally ordered until we re-sort it.
  return all.sort((a, b) => a.start_time.localeCompare(b.start_time))
}
