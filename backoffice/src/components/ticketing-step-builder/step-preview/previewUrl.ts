import type { TenantPublic } from "@/client"
import { getPortalBaseUrl } from "@/lib/portal-urls"

/** Portal route that renders the checkout for a live preview. */
export function getCheckoutPreviewUrl(
  baseUrl: string,
  popupSlug: string,
  language?: string | null,
): string {
  const url = new URL(`${baseUrl}/checkout/${popupSlug}/preview`)
  if (language) url.searchParams.set("lang", language)
  return url.toString()
}

/**
 * Everything the preview needs to load, or the reason it can't.
 *
 * The preview embeds the portal, so it depends on knowing where the portal
 * lives. On a deployed backoffice that is derived from the hostname; on
 * localhost it needs `VITE_PORTAL_DOMAIN`, and saying so beats a blank frame.
 */
export interface PreviewTarget {
  /** Absolute URL of the preview page, or null when it can't be built. */
  url: string | null
  /** Why the preview is unavailable. Only set when `url` is null. */
  reason?: string
}

export function resolvePreviewTarget(
  tenant: TenantPublic | null | undefined,
  popupSlug: string | null | undefined,
  language?: string | null,
): PreviewTarget {
  // Distinct from "no portal domain": the tenant is what carries the custom
  // domain and the slug, so without it there is nothing to build a URL from —
  // and pointing at an env var would send the reader down the wrong path.
  if (!tenant) {
    return {
      url: null,
      reason:
        "Could not load this workspace's tenant, so the portal URL is unknown. Reload the page; if it persists, check that your user has access to this tenant.",
    }
  }
  if (!popupSlug) {
    return { url: null, reason: "This event has no slug yet." }
  }
  const baseUrl = getPortalBaseUrl(tenant)
  if (!baseUrl) {
    return {
      url: null,
      reason:
        "The portal URL for this tenant could not be resolved. Set VITE_PORTAL_DOMAIN (e.g. localhost:3000 or dev.edgeos.world) and rebuild the backoffice to preview from this environment.",
    }
  }
  return { url: getCheckoutPreviewUrl(baseUrl, popupSlug, language) }
}

/** Origin of the preview iframe — the only origin we post the step draft to. */
export function previewOrigin(url: string): string {
  return new URL(url).origin
}
