import type { TenantPublic } from "@/client"

export function extractSubdomain(hostname: string): string | null {
  const parts = hostname.split(".")
  if (parts.length >= 2 && parts[0] !== "www") {
    return parts[0]
  }
  return null
}

const API_BASE =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ""

export async function fetchTenantBySlug(
  slug: string,
): Promise<TenantPublic | null> {
  const res = await fetch(`${API_BASE}/api/v1/tenants/public/${slug}`, {
    next: { revalidate: 300 },
  })
  if (!res.ok) return null
  return res.json()
}

/**
 * Resolve a tenant by its custom domain.
 *
 * Used by SSR layout (`generateMetadata`) and the client-side TenantProvider
 * when `resolveHostname` returns `isCustomDomain: true`.
 *
 * No Next.js cache is used here — backend Redis caches the result (TTL 5 min).
 */
export async function fetchTenantByDomain(
  domain: string,
): Promise<TenantPublic | null> {
  const res = await fetch(
    `${API_BASE}/api/v1/tenants/public/by-domain/${domain}`,
    { cache: "no-store" },
  )
  if (!res.ok) return null
  return res.json()
}
