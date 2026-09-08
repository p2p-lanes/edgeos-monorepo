import { type NextRequest, NextResponse } from "next/server"
import { errorResponse } from "./lib/server/backend"
import {
  isPublicStaticPath,
  requireApplicationHost,
} from "./lib/server/ingress"
import {
  requestHost,
  resolveRequestTenant,
  type ServerTenant,
  stripInternalTenantHeaders,
} from "./lib/server/tenant"
import { resolveHostname } from "./lib/tenant-resolution"

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const requestHeaders = stripInternalTenantHeaders(request.headers)
  requestHeaders.set(
    "x-portal-route",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  )
  const passthrough = () =>
    NextResponse.next({ request: { headers: requestHeaders } })
  if (isPublicStaticPath(request.nextUrl.pathname)) return passthrough()
  try {
    requireApplicationHost(requestHost(request.headers).hostname)
  } catch (error) {
    const response = errorResponse(error)
    return new NextResponse(response.body, response)
  }
  // BFF handlers resolve their own host; static worker updates need no tenant I/O.
  if (
    request.nextUrl.pathname.startsWith("/api/") ||
    request.nextUrl.pathname === "/sw.js"
  )
    return passthrough()
  const host = request.headers.get("host") ?? ""
  const { isCustomDomain } = resolveHostname(host)

  // Subdomain path: no API call needed — slug is resolved in layout/provider.
  if (!isCustomDomain) {
    return passthrough()
  }

  let tenantData: ServerTenant | null = null

  try {
    tenantData = await resolveRequestTenant(request.headers)
  } catch {
    // Backend unreachable — pass through, TenantProvider handles the error state.
    return passthrough()
  }

  if (!tenantData) {
    return passthrough()
  }

  // Forward tenant info to downstream SSR via request headers.
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
        // Carry the query across the rewrite: `new URL(path, base)` resets the
        // search, so an unqualified path silently drops ?lang=/?utm_*. Losing
        // ?lang here strips the language before SSR or the client can read it
        // and the checkout falls back to the popup default_language.
        const rewriteUrl = new URL(
          `/checkout/${slug}/checkout${request.nextUrl.search}`,
          request.url,
        )
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
        const rewriteUrl = new URL(
          `/coming-soon${request.nextUrl.search}`,
          request.url,
        )
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
  matcher: ["/:path*"],
}
