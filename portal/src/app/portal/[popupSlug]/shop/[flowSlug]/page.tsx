import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import { cookies } from "next/headers"
import type { PopupPublic } from "@/client"
import {
  LANGUAGE_COOKIE_KEY,
  normalizeLanguageTag,
} from "@/lib/language-storage"
import { queryKeys } from "@/lib/query-keys"
import { getServerContext } from "@/lib/server/bootstrap"
import { prefetchPortalShell, prefetchShop } from "@/lib/server/portal-queries"
import { sessionIdentity } from "@/lib/session-contract"
import { ShopCheckoutContent } from "./ShopCheckoutContent"

export default async function ShopFlowPage({
  params,
  searchParams,
}: {
  params: Promise<{ popupSlug: string; flowSlug: string }>
  searchParams: Promise<{ lang?: string; locale?: string }>
}) {
  const { popupSlug, flowSlug } = await params
  const query = await searchParams
  const context = await getServerContext()
  await prefetchPortalShell(context)
  const city = context.queryClient
    .getQueryData<PopupPublic[]>(queryKeys.popups.portal())
    ?.find((popup) => popup.slug === popupSlug)
  const language =
    normalizeLanguageTag(query.lang ?? query.locale) ??
    normalizeLanguageTag((await cookies()).get(LANGUAGE_COOKIE_KEY)?.value) ??
    city?.default_language ??
    "en"
  const runtime = await prefetchShop(
    context,
    popupSlug,
    flowSlug,
    language,
  ).catch(() => null)

  return (
    <HydrationBoundary state={dehydrate(context.queryClient)}>
      <ShopCheckoutContent
        popupId={city?.id}
        popupSlug={popupSlug}
        flowSlug={flowSlug}
        initialRuntime={runtime ?? undefined}
        initialRuntimeLanguage={language}
        initialRuntimeAudience={
          context.snapshot.session
            ? sessionIdentity(context.snapshot.session)
            : undefined
        }
      />
    </HydrationBoundary>
  )
}
