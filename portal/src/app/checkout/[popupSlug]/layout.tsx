import type { Metadata } from "next"
import {
  checkoutShareDescription,
  fetchCheckoutShareMeta,
} from "@/lib/checkout-share"
import { buildShareMetadata } from "@/lib/share-metadata"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"

/**
 * Server-side metadata for the (client) open-ticketing checkout page.
 *
 * The sibling `page.tsx` is a client component, so it can't own
 * `generateMetadata`. This layout supplies popup-level OpenGraph/Twitter tags
 * so a shared checkout link shows the event name, tagline and cover image
 * instead of the generic portal preview.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ popupSlug: string }>
}): Promise<Metadata> {
  const { popupSlug } = await params
  const tenant = await resolveTenantForMetadata()
  if (!tenant) return {}

  const meta = await fetchCheckoutShareMeta(popupSlug, tenant.id)
  if (!meta) return {}

  const description = checkoutShareDescription(meta)
  const imageUrl = meta.image_url ?? tenant.image_url ?? tenant.icon_url

  return buildShareMetadata({
    title: meta.name,
    socialTitle: `${meta.name} · ${tenant.name}`,
    description,
    imageUrl,
    imageAlt: meta.name,
  })
}

export default function CheckoutPopupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
