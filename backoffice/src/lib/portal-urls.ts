import type { TenantPublic } from "@/client"

const PORTAL_DOMAIN = import.meta.env.VITE_PORTAL_DOMAIN ?? ""

/** Returns the portal base URL for a tenant, or null if it can't be built. */
export function getPortalBaseUrl(
  tenant:
    | Pick<TenantPublic, "slug" | "custom_domain" | "custom_domain_active">
    | null
    | undefined,
): string | null {
  if (!tenant) return null
  if (tenant.custom_domain_active && tenant.custom_domain) {
    return `https://${tenant.custom_domain}`
  }
  if (tenant.slug && PORTAL_DOMAIN) {
    return `https://${tenant.slug}.${PORTAL_DOMAIN}`
  }
  return null
}

export function getPopupPortalUrl(baseUrl: string, popupSlug: string) {
  return `${baseUrl}/portal/${popupSlug}`
}

export function getPopupCheckoutUrl(baseUrl: string, popupSlug: string) {
  return `${baseUrl}/checkout/${popupSlug}`
}

export function getGroupPortalUrl(baseUrl: string, groupSlug: string) {
  return `${baseUrl}/groups/${groupSlug}`
}
