import "server-only"
import type { EventShareMeta } from "@/client"
import { backendFetch } from "./server/backend"

export type { EventShareMeta }

/**
 * Public server transport for event OpenGraph metadata; never sends a session.
 *
 * On 404/network failure returns `null` so the caller falls back to tenant-level
 * metadata from the root layout.
 */
export async function fetchEventShareMeta(
  eventId: string,
  tenantId: string,
): Promise<EventShareMeta | null> {
  try {
    const response = await backendFetch(
      `/api/v1/events/public/events/${encodeURIComponent(eventId)}/share`,
      { headers: { "X-Tenant-Id": tenantId } },
    )
    return response.ok ? response.json() : null
  } catch {
    return null
  }
}
