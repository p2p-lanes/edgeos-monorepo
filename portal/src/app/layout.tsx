import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"
import type { Metadata, Viewport } from "next"
import { headers } from "next/headers"
import "./globals.css"
import { Toaster } from "sonner"
import GoogleAnalytics from "@/components/utils/GoogleAnalytics"
import SegmentAnalytics from "@/components/utils/SegmentAnalytics"
import { fetchTenantBySlug } from "@/lib/tenant"
import { resolveHostname } from "@/lib/tenant-resolution"
import QueryProvider from "@/providers/queryProvider"
import { TenantProvider } from "@/providers/tenantProvider"

const FALLBACK_NAME = "Edge Portal"
const FALLBACK_DESCRIPTION =
  "Welcome to the Edge Portal. Log in or sign up to access events."

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()
  const host = headersList.get("host") ?? ""
  const { slug, isCustomDomain } = resolveHostname(host)

  // For custom domains, the middleware already resolved the tenant and set
  // x-tenant-slug — read it directly instead of making a redundant API call.
  const middlewareSlug = isCustomDomain
    ? (headersList.get("x-tenant-slug") ?? null)
    : null

  const tenant =
    middlewareSlug != null
      ? await fetchTenantBySlug(middlewareSlug)
      : slug
        ? await fetchTenantBySlug(slug)
        : null
  const name = tenant?.name ? `${tenant.name} Portal` : FALLBACK_NAME
  const description = tenant?.name
    ? `Welcome to the ${tenant.name} Portal. Log in or sign up to access ${tenant.name} events.`
    : FALLBACK_DESCRIPTION

  return {
    title: name,
    description,
    icons: {
      icon: tenant?.icon_url ?? "/icon.png",
    },
    openGraph: {
      title: name,
      description,
      ...(tenant?.image_url && {
        images: [
          {
            url: tenant.image_url,
            alt: name,
            width: 1200,
            height: 630,
          },
        ],
      }),
    },
  }
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const headersList = await headers()
  const isCustomDomain = headersList.get("x-custom-domain") === "true"
  const middlewareTenantId = isCustomDomain
    ? (headersList.get("x-tenant-id") ?? null)
    : null
  const middlewareTenantSlug = isCustomDomain
    ? (headersList.get("x-tenant-slug") ?? null)
    : null

  return (
    <html lang="en">
      <body
        className={`${GeistSans.variable} ${GeistSans.className} ${GeistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <GoogleAnalytics />
        <SegmentAnalytics />
        <QueryProvider>
          <TenantProvider
            initialTenantId={middlewareTenantId}
            initialTenantSlug={middlewareTenantSlug}
          >
            <div className="w-full bg-neutral-100">{children}</div>
          </TenantProvider>
        </QueryProvider>
        <Toaster position="bottom-center" richColors />
      </body>
    </html>
  )
}
