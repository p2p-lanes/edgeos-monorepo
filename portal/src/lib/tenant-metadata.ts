import { headers } from "next/headers"
import type { TenantPublic } from "@/client"
import { fetchTenantBySlug } from "@/lib/tenant"
import { resolveHostname } from "@/lib/tenant-resolution"

/** Resolve the active tenant for SSR metadata (root layout, share previews). */
export async function resolveTenantForMetadata(): Promise<TenantPublic | null> {
  const headersList = await headers()
  const host = headersList.get("host") ?? ""
  const { slug, isCustomDomain } = resolveHostname(host)
  const middlewareSlug = isCustomDomain
    ? (headersList.get("x-tenant-slug") ?? null)
    : null

  try {
    return middlewareSlug != null
      ? await fetchTenantBySlug(middlewareSlug)
      : slug
        ? await fetchTenantBySlug(slug)
        : null
  } catch (error) {
    console.error("Failed to resolve tenant metadata", {
      host,
      slug,
      middlewareSlug,
      isCustomDomain,
      error,
    })
    return null
  }
}

/** Absolute site origin for metadataBase (og:url resolution). */
export async function getMetadataBase(): Promise<URL | undefined> {
  const headersList = await headers()
  const host = headersList.get("host")
  if (!host) return undefined

  const proto = headersList.get("x-forwarded-proto") ?? "https"
  return new URL(`${proto}://${host}`)
}
