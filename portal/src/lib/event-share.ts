/**
 * Server-side fetch of an event's OpenGraph share metadata.
 *
 * Mirrors `fetchTenantBySlug` in `@/lib/tenant`: a plain `fetch` (not the
 * generated SDK) so we can set the `X-Tenant-Id` header server-side. The
 * backend route is public/unauthenticated and only returns published
 * public/unlisted events, so a 404 (private/draft/wrong-tenant/network) maps
 * to `null` and the caller falls back to the root layout metadata.
 */

if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error("NEXT_PUBLIC_API_URL is not configured")
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL

export interface EventShareMeta {
  id: string
  title: string
  description: string | null
  image_url: string | null
}

export async function fetchEventShareMeta(
  eventId: string,
  tenantId: string,
): Promise<EventShareMeta | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/events/public/events/${eventId}/share`,
      {
        headers: { "X-Tenant-Id": tenantId },
        next: { revalidate: 300 },
      },
    )
    if (!res.ok) return null
    return (await res.json()) as EventShareMeta
  } catch {
    return null
  }
}
