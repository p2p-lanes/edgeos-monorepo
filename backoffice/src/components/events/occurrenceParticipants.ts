import { EventParticipantsService } from "@/client"

/** Load the complete roster for exactly one date, or NULL for a one-off. */
export async function loadOccurrenceParticipants(
  eventId: string,
  occurrenceStart: string | null,
) {
  const request = {
    eventId,
    occurrenceStart: occurrenceStart ?? undefined,
    scopeToOccurrence: true,
  }
  let page = await EventParticipantsService.listParticipants(request)
  const results = [...page.results]
  while (
    page.paging &&
    page.paging.offset + page.paging.limit < page.paging.total
  ) {
    if (page.paging.limit <= 0) throw new Error("Invalid participant page size")
    page = await EventParticipantsService.listParticipants({
      ...request,
      skip: page.paging.offset + page.paging.limit,
    })
    results.push(...page.results)
  }
  return results.filter((participant) => participant.status !== "cancelled")
}
