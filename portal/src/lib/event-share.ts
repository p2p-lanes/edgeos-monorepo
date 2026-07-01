import "@/lib/api-client"
import { type EventShareMeta, EventsService } from "@/client"

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
  } catch {
    return null
  }
}
