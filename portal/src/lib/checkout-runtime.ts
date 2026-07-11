import type { CheckoutRuntimeResponse } from "@/client"

if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error("NEXT_PUBLIC_API_URL is not configured")
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL

/**
 * Server-side raw fetch of checkout runtime data.
 *
 * Uses `cache: "no-store"` to guarantee stock data reflects backend state at
 * the moment of the request — never a cached copy. A 1500ms AbortController
 * timeout prevents a slow backend from hanging TTFB.
 *
 * Returns `null` on any failure (non-2xx, timeout, network error) so the
 * caller degrades silently to the client-fetch path.
 */
export async function fetchCheckoutRuntime(
  slug: string,
  tenantId: string,
): Promise<CheckoutRuntimeResponse | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)

  try {
    const res = await fetch(`${API_BASE}/api/v1/checkout/${slug}/runtime`, {
      cache: "no-store",
      headers: {
        "X-Tenant-Id": tenantId,
        Accept: "application/json",
      },
      signal: controller.signal,
    })

    if (!res.ok) return null

    return (await res.json()) as CheckoutRuntimeResponse
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
