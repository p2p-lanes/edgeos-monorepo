import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"
import type { Metadata, Viewport } from "next"
import { cookies, headers } from "next/headers"
import { notFound } from "next/navigation"
import type { HumanPublic, TenantPublic } from "@/client"
import "./globals.css"
import { Toaster } from "sonner"
import { MetaPixel } from "@/components/MetaPixel"
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar"
import GoogleAnalytics from "@/components/utils/GoogleAnalytics"
import {
  LANGUAGE_COOKIE_KEY,
  normalizeLanguageTag,
} from "@/lib/language-storage"
import { queryKeys } from "@/lib/query-keys"
import { getServerContext } from "@/lib/server/bootstrap"
import { isStaticHost } from "@/lib/server/ingress"
import { requestHost } from "@/lib/server/tenant"
import { buildShareMetadata } from "@/lib/share-metadata"
import {
  getMetadataBase,
  resolveTenantForMetadata,
} from "@/lib/tenant-metadata"
import QueryProvider from "@/providers/queryProvider"
import { SessionI18n } from "@/providers/sessionI18n"
import { BootstrapRecovery, SessionProvider } from "@/providers/sessionProvider"
import { TenantProvider } from "@/providers/tenantProvider"

const FALLBACK_NAME = "Edge Portal"
const FALLBACK_DESCRIPTION =
  "Welcome to the Edge Portal. Log in or sign up to access events."

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveTenantForMetadata()
  const metadataBase = await getMetadataBase()

  const name = tenant?.name ? `${tenant.name} Portal` : FALLBACK_NAME
  const description = tenant?.name
    ? `Welcome to the ${tenant.name} Portal. Log in or sign up to access ${tenant.name} events.`
    : FALLBACK_DESCRIPTION

  return {
    metadataBase,
    ...buildShareMetadata({
      title: name,
      description,
      imageUrl: tenant?.image_url,
      imageAlt: name,
    }),
    icons: {
      icon: tenant?.icon_url ?? "/icons/icon.png",
      apple: tenant?.icon_url ?? "/icons/icon-192.png",
    },
  }
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#ffffff",
}

/**
 * Origin of the backend API, derived from the runtime env — never
 * hardcoded. Returns null when the env var is missing or malformed so the
 * preconnect hint is simply skipped instead of pointing somewhere wrong.
 */
function getApiOrigin(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "").origin
  } catch {
    return null
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The portal is client-rendered: every page pays DNS + TCP + TLS to the
  // API after hydration, in the critical path (tenant + checkout runtime
  // fetches). Preconnecting from the initial HTML moves those handshakes
  // off the critical path. Rendered as a <link> element (hoisted to <head>
  // by React) because react-dom's preconnect() is a no-op in Server
  // Components. `crossOrigin` matches the CORS mode of the SDK fetches so
  // the warmed connection is actually reused.
  const apiOrigin = getApiOrigin()

  const headersList = await headers()
  const route = new URL(
    headersList.get("x-portal-route") ?? "/",
    "http://portal.internal",
  )
  const initialLanguage =
    normalizeLanguageTag(
      route.searchParams.get("lang") ?? route.searchParams.get("locale"),
    ) ??
    normalizeLanguageTag((await cookies()).get(LANGUAGE_COOKIE_KEY)?.value) ??
    "en"
  if (isStaticHost(requestHost(new Headers(headersList)).hostname)) notFound()
  const context = await getServerContext().catch(() => null)
  if (!context)
    return (
      <html lang={initialLanguage}>
        <body>
          <SessionI18n language={initialLanguage}>
            <BootstrapRecovery />
          </SessionI18n>
        </body>
      </html>
    )
  const tenant = context.tenant
  if (context.snapshot.session)
    await context.queryClient.prefetchQuery({
      queryKey: queryKeys.profile.current,
      queryFn: () => context.api<HumanPublic>("/api/v1/humans/me"),
    })

  return (
    <html lang={initialLanguage}>
      <body
        className={`${GeistSans.variable} ${GeistSans.className} ${GeistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {apiOrigin && (
          <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />
        )}
        <SessionI18n language={initialLanguage}>
          <SessionProvider initial={context.snapshot}>
            <QueryProvider>
              <HydrationBoundary state={dehydrate(context.queryClient)}>
                <ServiceWorkerRegistrar />
                <TenantProvider
                  initialTenant={tenant as TenantPublic}
                  initialTenantId={tenant?.id ?? null}
                  initialTenantSlug={tenant?.slug ?? null}
                  initialLandingMode={tenant?.landing_mode ?? null}
                  initialActivePopupSlug={tenant?.active_popup_slug ?? null}
                >
                  <GoogleAnalytics />
                  <MetaPixel />
                  <div className="w-full">{children}</div>
                </TenantProvider>
              </HydrationBoundary>
            </QueryProvider>
          </SessionProvider>
        </SessionI18n>
        <Toaster position="bottom-center" richColors />
      </body>
    </html>
  )
}
