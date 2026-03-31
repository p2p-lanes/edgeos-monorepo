import { type NextRequest, NextResponse } from "next/server"
import { resolveHostname } from "./lib/tenant-resolution"

if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error("NEXT_PUBLIC_API_URL is not configured")
}

const API_URL = process.env.NEXT_PUBLIC_API_URL

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

  let tenantData: { id: string; slug: string } | null = null

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

  // Forward tenant info to downstream SSR via headers.
  const response = NextResponse.next()
  response.headers.set("x-tenant-id", tenantData.id)
  response.headers.set("x-tenant-slug", tenantData.slug)
  response.headers.set("x-custom-domain", "true")
  return response
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
