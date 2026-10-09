import { type EventParticipantPublic, EventParticipantsService } from "@/client"

/** Load the complete visible roster before comparing it with the seat count. */
export async function fetchAllPortalParticipants(
  eventId: string,
  occurrenceStart: string | null,
): Promise<EventParticipantPublic[]> {
  const request = {
    eventId,
    occurrenceStart: occurrenceStart ?? undefined,
  }
  const results: EventParticipantPublic[] = []
  let skip = 0
  let rawTotalUpperBound = Number.POSITIVE_INFINITY

  while (true) {
    const page = await EventParticipantsService.listPortalParticipants({
      ...request,
      ...(skip ? { skip } : {}),
    })
    results.push(...page.results)
    if (!page.paging) return results

    const { offset, limit, total } = page.paging
    if (offset !== skip || limit <= 0) {
      throw new Error("Invalid participant pagination")
    }
    // Privacy filtering happens AFTER pagination. The endpoint subtracts
    // names omitted on this page from total, but offsets address raw rows.
    // A short/empty visible page is therefore NOT proof that this is the end.
    // At most (limit - results.length) rows were omitted on this page; this
    // gives a safe upper bound for the raw total without needing private data.
    rawTotalUpperBound = Math.min(
      rawTotalUpperBound,
      total + limit - page.results.length,
    )
    skip = offset + limit
    if (skip >= rawTotalUpperBound) return results
  }
}
