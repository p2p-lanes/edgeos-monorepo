export const dynamic = "force-dynamic"

import { cookies } from "next/headers"
import { fetchCheckoutRuntime } from "@/lib/checkout-runtime"
import {
  LANGUAGE_COOKIE_KEY,
  normalizeLanguageTag,
} from "@/lib/language-storage"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"
import CheckoutPageClient from "../CheckoutPageClient"

/**
 * Named-flow checkout page (sdd/sales-flows D6 URL scheme —
 * `/checkout/{popupSlug}/{flowSlug}`).
 *
 * `thank-you`/`success` are reserved flow slugs (rejected at flow save
 * time) precisely so this dynamic segment never shadows those static
 * sibling routes — Next.js always gives a static segment priority over a
 * dynamic one at the same path depth.
 *
 * Renders through the exact same `CheckoutPageClient` as the legacy
 * `[popupSlug]/page.tsx` (no duplicated runtime) — only the resolved flow
 * differs.
 */
export default async function FlowCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ popupSlug: string; flowSlug: string }>
  searchParams: Promise<{ lang?: string; locale?: string }>
}) {
  const { popupSlug, flowSlug } = await params
  const { lang, locale } = await searchParams

  const tenant = await resolveTenantForMetadata()
  if (!tenant) {
    return <CheckoutPageClient popupSlug={popupSlug} flowSlug={flowSlug} />
  }

  // Mirrors the legacy page's precedence: explicit ?lang/?locale first, then
  // the persisted choice via the language cookie (localStorage is
  // unreachable server-side).
  const cookieStore = await cookies()
  const ssrLanguage =
    normalizeLanguageTag(lang ?? locale) ??
    normalizeLanguageTag(cookieStore.get(LANGUAGE_COOKIE_KEY)?.value)

  const runtime = await fetchCheckoutRuntime(
    popupSlug,
    tenant.id,
    ssrLanguage ?? undefined,
    flowSlug,
  )
  if (!runtime) {
    return <CheckoutPageClient popupSlug={popupSlug} flowSlug={flowSlug} />
  }

  const initialDataUpdatedAt = Date.now()
  return (
    <CheckoutPageClient
      popupSlug={popupSlug}
      flowSlug={flowSlug}
      initialRuntime={runtime}
      initialDataUpdatedAt={initialDataUpdatedAt}
      initialRuntimeLanguage={ssrLanguage}
    />
  )
}
