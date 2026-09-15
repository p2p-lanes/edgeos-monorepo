interface PortalEventHrefOptions {
  slug: string | undefined
  eventId: string
  flowId?: string | null
  from?: string | null
  occurrenceStart?: string | null
  suffix?: string
}

/** Build an event-detail URL while retaining the selected gathering door. */
export function buildPortalEventHref({
  slug,
  eventId,
  flowId,
  from,
  occurrenceStart,
  suffix = "",
}: PortalEventHrefOptions): string {
  const params = new URLSearchParams()
  if (flowId) params.set("flow", flowId)
  if (from) params.set("from", from)
  if (occurrenceStart) params.set("occ", occurrenceStart)

  const query = params.toString()
  const path = `/portal/${slug}/events/${eventId}${suffix}`
  return query ? `${path}?${query}` : path
}
