import "server-only"
import type { CheckoutShareMeta } from "@/client"
import { backendFetch } from "./server/backend"

export type { CheckoutShareMeta }

/**
 * Public server transport for checkout OpenGraph metadata; never sends a session.
 *
 * On 404/network failure returns `null` so the caller falls back to tenant-level
 * metadata from the root layout.
 */
export async function fetchCheckoutShareMeta(
  popupSlug: string,
  flowSlug: string,
  tenantId: string,
): Promise<CheckoutShareMeta | null> {
  try {
    const response = await backendFetch(
      `/api/v1/checkout/${encodeURIComponent(popupSlug)}/${encodeURIComponent(flowSlug)}/share`,
      { headers: { "X-Tenant-Id": tenantId } },
    )
    return response.ok ? response.json() : null
  } catch {
    return null
  }
}

export function checkoutShareDescription(meta: CheckoutShareMeta): string {
  if (meta.tagline) return meta.tagline
  if (meta.location) {
    return `Get tickets for ${meta.name} in ${meta.location}.`
  }
  return `Get tickets for ${meta.name}.`
}
