import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"
import type { Metadata, Viewport } from "next"
import { headers } from "next/headers"
import "./globals.css"
import { Toaster } from "sonner"
import { MetaPixel } from "@/components/MetaPixel"
import GoogleAnalytics from "@/components/utils/GoogleAnalytics"
import { buildShareMetadata } from "@/lib/share-metadata"
import {
  getMetadataBase,
  resolveTenantForMetadata,
} from "@/lib/tenant-metadata"
import QueryProvider from "@/providers/queryProvider"
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
  const isCustomDomain = headersList.get("x-custom-domain") === "true"
  const middlewareTenantId = isCustomDomain
    ? (headersList.get("x-tenant-id") ?? null)
    : null
  const middlewareTenantSlug = isCustomDomain
    ? (headersList.get("x-tenant-slug") ?? null)
    : null
  const middlewareLandingMode = isCustomDomain
    ? ((headersList.get("x-landing-mode") as "portal" | "checkout" | null) ??
      null)
    : null
  const middlewareActivePopupSlug = isCustomDomain
    ? (headersList.get("x-active-popup-slug") ?? null)
    : null

  return (
    <html lang="en">
      <body
        className={`${GeistSans.variable} ${GeistSans.className} ${GeistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {apiOrigin && (
          <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />
        )}
        <QueryProvider>
          <TenantProvider
            initialTenantId={middlewareTenantId}
            initialTenantSlug={middlewareTenantSlug}
            initialLandingMode={middlewareLandingMode}
            initialActivePopupSlug={middlewareActivePopupSlug}
          >
            <GoogleAnalytics />
            <MetaPixel />
            <div className="w-full">{children}</div>
          </TenantProvider>
        </QueryProvider>
        <Toaster position="bottom-center" richColors />
      </body>
    </html>
  )
}
