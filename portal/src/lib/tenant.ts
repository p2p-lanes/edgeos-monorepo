import type { TenantPublic } from "@/client"

export function extractSubdomain(
  hostname: string,
  searchParams?: string | null,
): string | null {
  // Check for ?tenant= query param (for Vercel preview deployments)
  if (searchParams) {
    const params = new URLSearchParams(searchParams)
    const tenantParam = params.get("tenant")
    if (tenantParam) return tenantParam
  }

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
