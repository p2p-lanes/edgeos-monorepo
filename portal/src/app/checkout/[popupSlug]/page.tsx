export const dynamic = "force-dynamic"

import { cookies } from "next/headers"
import { fetchCheckoutRuntime } from "@/lib/checkout-runtime"
import {
  LANGUAGE_COOKIE_KEY,
  normalizeLanguageTag,
} from "@/lib/language-storage"
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

  // Mirrors the client resolver's precedence: explicit ?lang/?locale first,
  // then the persisted choice. localStorage is unreachable here, so the cookie
  // the language provider writes alongside it is what lets the server render
  // already be in the visitor's language instead of the popup's source copy.
  const cookieStore = await cookies()
  const ssrLanguage =
    normalizeLanguageTag(lang ?? locale) ??
    normalizeLanguageTag(cookieStore.get(LANGUAGE_COOKIE_KEY)?.value)

  const runtime = await fetchCheckoutRuntime(
    popupSlug,
    tenant.id,
    ssrLanguage ?? undefined,
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
      initialRuntimeLanguage={ssrLanguage}
    />
  )
}
