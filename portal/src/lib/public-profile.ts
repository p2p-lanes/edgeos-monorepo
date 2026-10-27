import "@/lib/api-client"
import type { Metadata } from "next"
import { cache } from "react"
import { HumansService, type PublicProfile, type TenantPublic } from "@/client"
import { buildShareMetadata } from "@/lib/share-metadata"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"

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

/** Same card behind its readable alias (portal.<tenant>/<username>). */
export async function fetchPublicProfileByUsername(
  username: string,
  tenantId: string,
): Promise<PublicProfile | null> {
  try {
    return await HumansService.getPublicProfileByUsername({
      username,
      xTenantId: tenantId,
    })
  } catch {
    return null
  }
}

export interface LoadedPublicProfile {
  tenant: TenantPublic
  profile: PublicProfile
}

/**
 * Tenant plus profile for a share page, by token or username. Cached per
 * request so `generateMetadata` and the page share one round trip.
 */
export const loadPublicProfile = cache(
  async (
    by: "token" | "username",
    handle: string,
  ): Promise<LoadedPublicProfile | null> => {
    const tenant = await resolveTenantForMetadata()
    if (!tenant) return null
    const profile =
      by === "token"
        ? await fetchPublicProfile(handle, tenant.id)
        : await fetchPublicProfileByUsername(handle, tenant.id)
    return profile ? { tenant, profile } : null
  },
)

export function buildPublicProfileMetadata({
  tenant,
  profile,
}: LoadedPublicProfile): Metadata {
  const name = profile.display_name ?? tenant.name
  const count = profile.badges.length

  return {
    ...buildShareMetadata({
      title: `${name} · ${tenant.name}`,
      description: `${count} badge${count === 1 ? "" : "s"} at ${tenant.name}`,
      imageUrl: profile.badges[0]?.image_url ?? profile.picture_url,
      imageAlt: name,
    }),
    // Share links are personal: keep them out of search results.
    robots: { index: false, follow: false },
  }
}
