import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PublicProfileView } from "@/components/badges/PublicProfileView"
import { fetchPublicProfile } from "@/lib/public-profile"
import { buildShareMetadata } from "@/lib/share-metadata"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"

type Params = { params: Promise<{ token: string }> }

async function load(token: string) {
  const tenant = await resolveTenantForMetadata()
  if (!tenant) return null
  const profile = await fetchPublicProfile(token, tenant.id)
  return profile ? { tenant, profile } : null
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params
  const data = await load(token)
  if (!data) return {}
  const { tenant, profile } = data
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

/** Public, login-free profile card behind a human's share link (SIM-108). */
export default async function PublicProfilePage({ params }: Params) {
  const { token } = await params
  const data = await load(token)
  if (!data) notFound()

  return (
    <PublicProfileView
      profile={data.profile}
      tenantName={data.tenant.name}
      tenantLogoUrl={data.tenant.logo_url ?? data.tenant.icon_url}
    />
  )
}
