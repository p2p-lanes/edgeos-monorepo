import { notFound, redirect } from "next/navigation"
import type { PopupPublic } from "@/client"
import { PortalHttpError } from "@/lib/server/backend"
import { getServerContext } from "@/lib/server/bootstrap"
import { BootstrapRecovery } from "@/providers/sessionProvider"

interface PopupRoutePageProps {
  params: Promise<{
    popupSlug: string
  }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PopupRoutePage({
  params,
  searchParams,
}: PopupRoutePageProps) {
  const { popupSlug } = await params
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value])
      query.append(key, item)
  }
  const suffix = query.size ? `?${query}` : ""
  let popup: PopupPublic | undefined
  try {
    const context = await getServerContext()
    popup = context.snapshot.session
      ? await context.api<PopupPublic>(
          `/api/v1/popups/portal/${encodeURIComponent(popupSlug)}`,
        )
      : (await context.api<PopupPublic[]>("/api/v1/popups/public/list")).find(
          (item) => item.slug === popupSlug,
        )
  } catch (error) {
    if (error instanceof PortalHttpError && error.status === 404) notFound()
    return <BootstrapRecovery />
  }

  // Only a gathering nobody applies to lands straight on the checkout. One
  // that takes applications belongs in the portal even when some of its doors
  // also sell, which is why this cannot read `sale_type` any more.
  if (popup?.takes_applications === false) {
    redirect(`/checkout/${encodeURIComponent(popup.slug)}/checkout${suffix}`)
  }

  redirect(`/portal/${encodeURIComponent(popup?.slug ?? popupSlug)}${suffix}`)
}
