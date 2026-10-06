import "@/lib/api-client"
import { HumansService, type PublicProfile } from "@/client"

export type { PublicProfile }

/**
 * Server-side fetch of a human's public profile card (name, avatar, badges).
 *
 * Unknown, reset and disabled links all 404 on the backend; any failure
 * returns `null` so the page can render its not-found state.
 */
export async function fetchPublicProfile(
  token: string,
  tenantId: string,
): Promise<PublicProfile | null> {
  try {
    return await HumansService.getPublicProfile({ token, xTenantId: tenantId })
  } catch {
    return null
  }
}
