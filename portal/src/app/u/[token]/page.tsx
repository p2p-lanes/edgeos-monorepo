import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PublicProfileView } from "@/components/badges/PublicProfileView"
import {
  buildPublicProfileMetadata,
  loadPublicProfile,
} from "@/lib/public-profile"

type Params = { params: Promise<{ token: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params
  const data = await loadPublicProfile("token", token)
  return data ? buildPublicProfileMetadata(data) : {}
}

/** Public, login-free profile card behind a human's share link (SIM-108). */
export default async function PublicProfilePage({ params }: Params) {
  const { token } = await params
  const data = await loadPublicProfile("token", token)
  if (!data) notFound()

  return (
    <PublicProfileView
      profile={data.profile}
      handle={{ token }}
      tenantName={data.tenant.name}
      tenantLogoUrl={data.tenant.logo_url ?? data.tenant.icon_url}
    />
  )
}
