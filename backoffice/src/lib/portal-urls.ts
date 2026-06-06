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

export function getSelfCheckInUrl(baseUrl: string, popupSlug: string) {
  const url = new URL(`${baseUrl}/portal/${popupSlug}/check-in`)
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    url.protocol = "http:"
  }
  return url.toString()
}

export function getGroupPortalUrl(baseUrl: string, groupSlug: string) {
  return `${baseUrl}/groups/${groupSlug}`
}

export function getInvitePortalUrl(baseUrl: string, token: string) {
  return `${baseUrl}/invite/${token}`
}
