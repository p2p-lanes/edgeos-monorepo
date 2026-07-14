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
  lang?: string,
): Promise<CheckoutRuntimeResponse | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)

  try {
    // Forward an explicit ?lang= deep link as Accept-Language so the SSR render
    // is already translated. localStorage is not available server-side; the
    // in-session switch path is covered by the client refetch on language change.
    const headers: Record<string, string> = {
      "X-Tenant-Id": tenantId,
      Accept: "application/json",
    }
    if (lang) {
      headers["Accept-Language"] = lang
    }
    const res = await fetch(
      `${API_BASE}/api/v1/checkout/${encodeURIComponent(slug)}/runtime`,
      {
        cache: "no-store",
        headers,
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      console.error("Checkout runtime SSR fetch degraded", {
        slug,
        status: res.status,
      })
      return null
    }

    return (await res.json()) as CheckoutRuntimeResponse
  } catch (error) {
    console.error("Checkout runtime SSR fetch degraded", { slug, error })
    return null
  } finally {
    clearTimeout(timeout)
  }
}
