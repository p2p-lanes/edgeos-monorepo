export const dynamic = "force-dynamic"

import type { Metadata } from "next"
import { cookies } from "next/headers"
import type { CheckoutRuntimeResponse } from "@/client"
import {
  checkoutShareDescription,
  fetchCheckoutShareMeta,
} from "@/lib/checkout-share"
import {
  LANGUAGE_COOKIE_KEY,
  normalizeLanguageTag,
} from "@/lib/language-storage"
import { getServerContext } from "@/lib/server/bootstrap"
import { sessionIdentity } from "@/lib/session-contract"
import { buildShareMetadata } from "@/lib/share-metadata"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"
import { SessionI18n } from "@/providers/sessionI18n"
import CheckoutPageClient from "../CheckoutPageClient"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ popupSlug: string; flowSlug: string }>
}): Promise<Metadata> {
  const { popupSlug, flowSlug } = await params
  const tenant = await resolveTenantForMetadata()
  if (!tenant) return {}

  const meta = await fetchCheckoutShareMeta(popupSlug, flowSlug, tenant.id)
  if (!meta) return {}

  return buildShareMetadata({
    title: meta.name,
    socialTitle: `${meta.name} · ${tenant.name}`,
    description: checkoutShareDescription(meta),
    imageUrl: meta.image_url ?? tenant.image_url ?? tenant.icon_url,
    imageAlt: meta.name,
  })
}

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

  const context = await getServerContext()
  const runtime = await context
    .api<CheckoutRuntimeResponse>(
      `/api/v1/checkout/${encodeURIComponent(popupSlug)}/${encodeURIComponent(flowSlug)}/runtime`,
      ssrLanguage,
    )
    .catch(() => null)
  if (!runtime) {
    return <CheckoutPageClient popupSlug={popupSlug} flowSlug={flowSlug} />
  }

  const initialDataUpdatedAt = Date.now()
  return (
    <SessionI18n
      language={ssrLanguage ?? runtime.popup.default_language ?? "en"}
    >
      <CheckoutPageClient
        popupSlug={popupSlug}
        flowSlug={flowSlug}
        initialRuntime={runtime}
        initialDataUpdatedAt={initialDataUpdatedAt}
        initialRuntimeLanguage={
          ssrLanguage ?? runtime.popup.default_language ?? "en"
        }
        initialRuntimeAudience={
          context.snapshot.session
            ? sessionIdentity(context.snapshot.session)
            : undefined
        }
      />
    </SessionI18n>
  )
}
