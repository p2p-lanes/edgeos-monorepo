import type { Metadata } from "next"
import { headers } from "next/headers"
import { fetchEventShareMeta } from "@/lib/event-share"
import { fetchTenantBySlug } from "@/lib/tenant"
import { resolveHostname } from "@/lib/tenant-resolution"

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

  // Resolve the tenant exactly like the root layout's generateMetadata
  // (src/app/layout.tsx): custom domains carry x-tenant-slug from middleware,
  // otherwise the slug comes from the subdomain.
  const headersList = await headers()
  const host = headersList.get("host") ?? ""
  const { slug, isCustomDomain } = resolveHostname(host)
  const middlewareSlug = isCustomDomain
    ? (headersList.get("x-tenant-slug") ?? null)
    : null

  let tenant = null
  try {
    tenant =
      middlewareSlug != null
        ? await fetchTenantBySlug(middlewareSlug)
        : slug
          ? await fetchTenantBySlug(slug)
          : null
  } catch (error) {
    console.error("Failed to resolve tenant for event share metadata", {
      host,
      slug,
      middlewareSlug,
      isCustomDomain,
      error,
    })
  }

  if (!tenant) return {}

  const meta = await fetchEventShareMeta(eventId, tenant.id)
  if (!meta) return {}

  const description = meta.description ?? undefined
  const ogTitle = `${meta.title} · ${tenant.name}`

  return {
    title: meta.title,
    description,
    openGraph: {
      title: ogTitle,
      description,
      ...(meta.image_url && {
        images: [
          { url: meta.image_url, width: 1200, height: 630, alt: meta.title },
        ],
      }),
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
      ...(meta.image_url && { images: [meta.image_url] }),
    },
  }
}

export default function EventLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
