import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import type { Metadata } from "next"
import { cookies, headers } from "next/headers"
import type { PopupPublic } from "@/client"
import {
  LANGUAGE_COOKIE_KEY,
  normalizeLanguageTag,
} from "@/lib/language-storage"
import { queryKeys } from "@/lib/query-keys"
import { getServerContext } from "@/lib/server/bootstrap"
import { prefetchPortalShell, prefetchShop } from "@/lib/server/portal-queries"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"
import { RequestLanguageProvider } from "@/providers/requestLanguageProvider"
import { SessionI18n } from "@/providers/sessionI18n"
import PortalShell from "./PortalShell"

const FALLBACK_NAME = "Edge Portal"

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveTenantForMetadata()
  const name = tenant?.name ? `${tenant.name} Portal` : FALLBACK_NAME

  return {
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: name,
    },
  }
}

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const context = await getServerContext().catch(() => null)
  if (context) await prefetchPortalShell(context)
  const route = new URL(
    (await headers()).get("x-portal-route") ?? "/portal",
    "http://portal.internal",
  )
  const shop = route.pathname.match(/^\/portal\/([^/]+)\/shop\/([^/]+)$/)
  const popupSlug = route.pathname.split("/")[2]
  const popup = context?.queryClient
    .getQueryData<PopupPublic[]>(queryKeys.popups.portal())
    ?.find((item) => item.slug === popupSlug)
  const language =
    normalizeLanguageTag(
      route.searchParams.get("lang") ?? route.searchParams.get("locale"),
    ) ??
    normalizeLanguageTag((await cookies()).get(LANGUAGE_COOKIE_KEY)?.value) ??
    popup?.default_language ??
    "en"
  // Hydrate before any persistent provider observes these keys. A page-level
  // boundary alone defers existing query updates until effects, leaving SSR empty.
  if (context && shop)
    await prefetchShop(
      context,
      decodeURIComponent(shop[1]),
      decodeURIComponent(shop[2]),
      language,
    ).catch(() => null)
  return (
    <HydrationBoundary
      state={context ? dehydrate(context.queryClient) : undefined}
    >
      <RequestLanguageProvider language={language}>
        <SessionI18n language={language}>
          <PortalShell>{children}</PortalShell>
        </SessionI18n>
      </RequestLanguageProvider>
    </HydrationBoundary>
  )
}
