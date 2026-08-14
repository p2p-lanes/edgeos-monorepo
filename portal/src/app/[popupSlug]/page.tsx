import { notFound, redirect } from "next/navigation"

interface PopupRoutePageProps {
  params: Promise<{
    popupSlug: string
  }>
}

export default async function PopupRoutePage({ params }: PopupRoutePageProps) {
  const { popupSlug } = await params
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL

  if (!apiBaseUrl) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured")
  }

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/popups/portal/${popupSlug}`, {
      cache: "no-store",
    })
  } catch {
    // Network/backend unreachable: show the 404 page instead of a raw
    // server-side exception.
    notFound()
  }

  // Any non-OK status (404 unknown slug, 401 anonymous SSR request, etc.)
  // resolves to the not-found page rather than throwing.
  if (!response.ok) {
    notFound()
  }

  const popup = (await response.json()) as {
    takes_applications?: boolean
    slug: string
  }

  // Only a gathering nobody applies to lands straight on the checkout. One
  // that takes applications belongs in the portal even when some of its doors
  // also sell, which is why this cannot read `sale_type` any more.
  if (popup.takes_applications === false) {
    redirect(`/checkout/${popup.slug}`)
  }

  redirect(`/portal/${popup.slug}`)
}
