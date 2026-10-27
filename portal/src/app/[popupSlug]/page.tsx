import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { PublicProfileView } from "@/components/badges/PublicProfileView"
import {
  buildPublicProfileMetadata,
  loadPublicProfile,
} from "@/lib/public-profile"

interface PopupRoutePageProps {
  params: Promise<{
    popupSlug: string
  }>
}

/**
 * The root path belongs to popups first. A slug no popup takes may be
 * someone's profile alias (portal.<tenant>/<username>); the backend never
 * resolves an alias a popup slug holds, so the popup always wins.
 */
async function fetchPopup(
  apiBaseUrl: string,
  popupSlug: string,
): Promise<{ takes_applications?: boolean; slug: string } | null> {
  try {
    const response = await fetch(
      `${apiBaseUrl}/api/v1/popups/portal/${popupSlug}`,
      { cache: "no-store" },
    )
    // Any non-OK status (404 unknown slug, 401 anonymous SSR request, etc.)
    // falls through to the alias lookup, then the not-found page.
    return response.ok ? await response.json() : null
  } catch {
    // Network/backend unreachable: show the 404 page instead of a raw
    // server-side exception.
    return null
  }
}

export async function generateMetadata({
  params,
}: PopupRoutePageProps): Promise<Metadata> {
  const { popupSlug } = await params
  const data = await loadPublicProfile("username", popupSlug)
  return data ? buildPublicProfileMetadata(data) : {}
}

export default async function PopupRoutePage({ params }: PopupRoutePageProps) {
  const { popupSlug } = await params
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL

  if (!apiBaseUrl) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured")
  }

  const popup = await fetchPopup(apiBaseUrl, popupSlug)
  if (popup) {
    // Only a gathering nobody applies to lands straight on the checkout. One
    // that takes applications belongs in the portal even when some of its
    // doors also sell, which is why this cannot read `sale_type` any more.
    if (popup.takes_applications === false) {
      redirect(`/checkout/${popup.slug}/checkout`)
    }
    redirect(`/portal/${popup.slug}`)
  }

  const data = await loadPublicProfile("username", popupSlug)
  if (!data) notFound()

  return (
    <PublicProfileView
      profile={data.profile}
      handle={{ username: data.profile.username ?? popupSlug }}
      tenantName={data.tenant.name}
      tenantLogoUrl={data.tenant.logo_url ?? data.tenant.icon_url}
    />
  )
}
