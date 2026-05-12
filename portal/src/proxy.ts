import { type NextRequest, NextResponse } from "next/server"
import { resolveHostname } from "./lib/tenant-resolution"

if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error("NEXT_PUBLIC_API_URL is not configured")
}

const API_URL = process.env.NEXT_PUBLIC_API_URL

interface TenantByDomainResponse {
  id: string
  slug: string
  landing_mode: "portal" | "checkout"
  active_popup_slug: string | null
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const host = request.headers.get("host") ?? ""
  const { isCustomDomain } = resolveHostname(host)

  // Subdomain path: no API call needed — slug is resolved in layout/provider.
  if (!isCustomDomain) {
    return NextResponse.next()
  }

  // Custom domain path: resolve tenant via backend.
  // Strip port — domain identity is the hostname only (port is infrastructure).
  const domain = host.split(":")[0] ?? host

  let tenantData: TenantByDomainResponse | null = null

  try {
    const res = await fetch(
      `${API_URL}/api/v1/tenants/public/by-domain/${encodeURIComponent(domain)}`,
      // No Next.js cache — backend Redis is the single cache layer.
      { cache: "no-store" },
    )

    if (!res.ok) {
      // Pass through — TenantProvider renders "Site not available" page.
      return NextResponse.next()
    }

    tenantData = await res.json()
  } catch {
    // Backend unreachable — pass through, TenantProvider handles the error state.
    return NextResponse.next()
  }

  if (!tenantData) {
    return NextResponse.next()
  }

  // Forward tenant info to downstream SSR via request headers.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-tenant-id", tenantData.id)
  requestHeaders.set("x-tenant-slug", tenantData.slug)
  requestHeaders.set("x-custom-domain", "true")
  requestHeaders.set("x-landing-mode", tenantData.landing_mode)
  if (tenantData.active_popup_slug != null) {
    requestHeaders.set("x-active-popup-slug", tenantData.active_popup_slug)
  }

  // Rewrite decision: only trigger on the two exact path shapes that need
  // transparent URL substitution. All other paths fall through unchanged.
  const pathname = request.nextUrl.pathname

  if (tenantData.landing_mode === "checkout") {
    if (tenantData.active_popup_slug != null) {
      const slug = tenantData.active_popup_slug

      if (pathname === "/") {
        const rewriteUrl = new URL(`/checkout/${slug}`, request.url)
        return NextResponse.rewrite(rewriteUrl, {
          request: { headers: requestHeaders },
        })
      }

      if (pathname === "/thank-you") {
        const rewriteUrl = new URL(
          `/checkout/${slug}/thank-you${request.nextUrl.search}`,
          request.url,
        )
        return NextResponse.rewrite(rewriteUrl, {
          request: { headers: requestHeaders },
        })
      }
    } else {
      // No active popup — show Coming Soon page.
      if (pathname === "/") {
        const rewriteUrl = new URL("/coming-soon", request.url)
        return NextResponse.rewrite(rewriteUrl, {
          request: { headers: requestHeaders },
        })
      }
    }
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static  (static files)
     * - _next/image   (image optimisation)
     * - favicon.ico, icon.png, robots.txt
     * - Common static asset extensions
     */
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|otf|ico)$).*)",
  ],
}
