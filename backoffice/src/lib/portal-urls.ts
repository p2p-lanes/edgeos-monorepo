import type { TenantPublic } from "@/client"

const PORTAL_DOMAIN = import.meta.env.VITE_PORTAL_DOMAIN ?? ""

/**
 * The portal's root domain for the current environment. Tenants live at
 * `{slug}.{root}` (e.g. `demo.dev.edgeos.world`, `edgecity.edgeos.world`).
 *
 * Prefers an explicit `VITE_PORTAL_DOMAIN`; otherwise derives it from the
 * backoffice's own hostname. The backoffice sits at a sibling subdomain of
 * the portal (`app.<root>`), so dropping the first label yields the root —
 * which keeps dev (`app.dev.edgeos.world` → `dev.edgeos.world`) and prod
 * (`app.edgeos.world` → `edgeos.world`) working with no extra config.
 * Returns "" on hosts we can't derive from (localhost, preview domains),
 * where an explicit env var is still needed.
 */
function getPortalRootDomain(): string {
  if (PORTAL_DOMAIN) return PORTAL_DOMAIN
  if (typeof window === "undefined") return ""
  const host = window.location.hostname
  if (host !== "edgeos.world" && !host.endsWith(".edgeos.world")) return ""
  const firstDot = host.indexOf(".")
  if (firstDot <= 0) return ""
  const root = host.slice(firstDot + 1)
  // Require a real apex (still has a dot) so e.g. the bare apex never
  // collapses to a TLD.
  return root.includes(".") ? root : ""
}

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
  const root = getPortalRootDomain()
  if (tenant.slug && root) {
    return `https://${tenant.slug}.${root}`
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
