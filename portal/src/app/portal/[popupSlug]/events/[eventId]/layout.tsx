import type { Metadata } from "next"
import { fetchEventShareMeta } from "@/lib/event-share"
import { buildShareMetadata } from "@/lib/share-metadata"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"

/**
 * Server-side metadata for the (client) event detail page.
 *
 * The sibling `page.tsx` is a client component, so it can't own
 * `generateMetadata`. This route-segment layout supplies event-level
 * OpenGraph/Twitter tags so a shared event link renders the real title,
 * a short snippet and the cover image instead of the generic portal preview.
 *
 * Any failure (private/draft event, 404, network, unresolved tenant) returns
 * `{}` so Next merges the root layout's tenant-level metadata — current
 * behavior is preserved.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ popupSlug: string; eventId: string }>
}): Promise<Metadata> {
  const { eventId } = await params
  const tenant = await resolveTenantForMetadata()
  if (!tenant) return {}

  const meta = await fetchEventShareMeta(eventId, tenant.id)
  if (!meta) return {}

  const description = meta.description ?? undefined

  return buildShareMetadata({
    title: meta.title,
    socialTitle: `${meta.title} · ${tenant.name}`,
    description,
    imageUrl: meta.image_url,
    imageAlt: meta.title,
  })
}

export default function EventLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
