import "@/lib/api-client"
import { ApiError, EventsService, type EventShareMeta } from "@/client"

export type { EventShareMeta }

/**
 * Server-side fetch of an event's OpenGraph share metadata via the generated SDK.
 *
 * On 404/network failure returns `null` so the caller falls back to tenant-level
 * metadata from the root layout.
 */
export async function fetchEventShareMeta(
  eventId: string,
  tenantId: string,
): Promise<EventShareMeta | null> {
  try {
    return await EventsService.getPublicEventShareMeta({
      eventId,
      xTenantId: tenantId,
    })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null
    }
    return null
  }
}
