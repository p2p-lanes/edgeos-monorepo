import { notFound, redirect } from "next/navigation"
import { fetchPrimaryCheckoutFlowSlug } from "@/lib/checkout-primary"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"

type CheckoutAliasSearchParams = Record<string, string | string[] | undefined>

interface CheckoutAliasPageProps {
  params: Promise<{ popupSlug: string }>
  searchParams: Promise<CheckoutAliasSearchParams>
}

function serializeSearchParams(values: CheckoutAliasSearchParams): string {
  const result = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(key, item)
    } else if (value !== undefined) {
      result.append(key, value)
    }
  }
  const query = result.toString()
  return query ? `?${query}` : ""
}

/**
 * Stable popup-level checkout alias. The backend's `is_default` flow is the
 * authority, so renaming or replacing a primary flow does not break this URL.
 */
export default async function CheckoutAliasPage({
  params,
  searchParams,
}: CheckoutAliasPageProps) {
  const [{ popupSlug }, queryValues, tenant] = await Promise.all([
    params,
    searchParams,
    resolveTenantForMetadata(),
  ])

  if (!tenant) return notFound()

  const flowSlug = await fetchPrimaryCheckoutFlowSlug(popupSlug, tenant.id)
  if (!flowSlug) return notFound()

  const destination = `/checkout/${encodeURIComponent(popupSlug)}/${encodeURIComponent(flowSlug)}`
  redirect(`${destination}${serializeSearchParams(queryValues)}`)
}
