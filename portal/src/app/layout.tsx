import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"
import type { Metadata, Viewport } from "next"
import { headers } from "next/headers"
import "./globals.css"
import { Toaster } from "sonner"
import GoogleAnalytics from "@/components/utils/GoogleAnalytics"
import { extractSubdomain, fetchTenantBySlug } from "@/lib/tenant"
import QueryProvider from "@/providers/queryProvider"
import { TenantProvider } from "@/providers/tenantProvider"

const FALLBACK_NAME = "Edge Portal"
const FALLBACK_DESCRIPTION =
  "Welcome to the Edge Portal. Log in or sign up to access events."

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()
  const host = headersList.get("host") ?? ""
  const slug = extractSubdomain(host)

  const tenant = slug ? await fetchTenantBySlug(slug) : null
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${GeistSans.variable} ${GeistSans.className} ${GeistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <GoogleAnalytics />
        <QueryProvider>
          <TenantProvider>
            <div className="w-full bg-neutral-100">{children}</div>
          </TenantProvider>
        </QueryProvider>
        <Toaster position="bottom-center" richColors />
      </body>
    </html>
  )
}
