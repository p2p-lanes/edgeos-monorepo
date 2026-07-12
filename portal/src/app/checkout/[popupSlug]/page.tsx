export const dynamic = "force-dynamic"

import { fetchCheckoutRuntime } from "@/lib/checkout-runtime"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"
import CheckoutPageClient from "./CheckoutPageClient"

export default async function OpenTicketingCheckoutPage({
  params,
}: {
  params: Promise<{ popupSlug: string }>
}) {
  const { popupSlug } = await params

  const tenant = await resolveTenantForMetadata()
  if (!tenant) {
    return <CheckoutPageClient popupSlug={popupSlug} />
  }

  const runtime = await fetchCheckoutRuntime(popupSlug, tenant.id)
  if (!runtime) {
    return <CheckoutPageClient popupSlug={popupSlug} />
  }

  const initialDataUpdatedAt = Date.now()
  return (
    <CheckoutPageClient
      popupSlug={popupSlug}
      initialRuntime={runtime}
      initialDataUpdatedAt={initialDataUpdatedAt}
    />
  )
}
