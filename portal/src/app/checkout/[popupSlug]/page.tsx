export const dynamic = "force-dynamic"

import { fetchCheckoutRuntime } from "@/lib/checkout-runtime"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"
import CheckoutPageClient from "./CheckoutPageClient"

export default async function OpenTicketingCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ popupSlug: string }>
  searchParams: Promise<{ lang?: string; locale?: string }>
}) {
  const { popupSlug } = await params
  const { lang, locale } = await searchParams

  const tenant = await resolveTenantForMetadata()
  if (!tenant) {
    return <CheckoutPageClient popupSlug={popupSlug} />
  }

  const runtime = await fetchCheckoutRuntime(
    popupSlug,
    tenant.id,
    lang ?? locale,
  )
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
