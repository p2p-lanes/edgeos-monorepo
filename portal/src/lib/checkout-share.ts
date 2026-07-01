import "@/lib/api-client"
import { CheckoutService, type CheckoutShareMeta } from "@/client"

export type { CheckoutShareMeta }

/**
 * Server-side fetch of checkout OpenGraph share metadata via the generated SDK.
 *
 * On 404/network failure returns `null` so the caller falls back to tenant-level
 * metadata from the root layout.
 */
export async function fetchCheckoutShareMeta(
  popupSlug: string,
  tenantId: string,
): Promise<CheckoutShareMeta | null> {
  try {
    return await CheckoutService.getCheckoutShareMeta({
      slug: popupSlug,
      xTenantId: tenantId,
    })
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
