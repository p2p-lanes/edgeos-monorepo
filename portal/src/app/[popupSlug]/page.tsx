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

  const response = await fetch(
    `${apiBaseUrl}/api/v1/popups/portal/${popupSlug}`,
    {
      cache: "no-store",
    },
  )

  if (response.status === 404) {
    notFound()
  }

  if (!response.ok) {
    throw new Error(`Failed to resolve popup ${popupSlug}`)
  }

  const popup = (await response.json()) as { sale_type?: string; slug: string }

  if (popup.sale_type === "direct") {
    redirect(`/checkout/${popup.slug}`)
  }

  redirect(`/portal/${popup.slug}`)
}
