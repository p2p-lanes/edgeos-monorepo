import type { PrimaryCheckoutFlow } from "@/client"

if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error("NEXT_PUBLIC_API_URL is not configured")
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL

/** Resolve the database-authoritative primary flow for a popup. */
export async function fetchPrimaryCheckoutFlowSlug(
  popupSlug: string,
  tenantId: string,
): Promise<string | null> {
  try {
    const path = `/api/v1/checkout/${encodeURIComponent(popupSlug)}/primary`
    const response = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-Tenant-Id": tenantId,
      },
    })

    if (!response.ok) return null

    const body = (await response.json()) as PrimaryCheckoutFlow
    return body.flow_slug || null
  } catch (error) {
    console.error("Primary checkout flow resolution failed", {
      popupSlug,
      error,
    })
    return null
  }
}
