import "server-only"
import { allowedPortalPath, allowsPreview } from "./api-policy"
import {
  backendFetch,
  errorResponse,
  PortalHttpError,
  PRIVATE_HEADERS,
  readBody,
} from "./backend"
import { ingressHeaders } from "./ingress"
import { sessionToken, validateSession } from "./session"
import { requestHost, requireSameOrigin, resolveRequestTenant } from "./tenant"

export async function handlePortalApi(
  request: Request,
  segments: string[],
): Promise<Response> {
  try {
    const url = new URL(request.url)
    if (
      !allowedPortalPath(request.method, segments) ||
      url.pathname !== `/api/v1/${segments.join("/")}`
    ) {
      throw new PortalHttpError(404, "route_not_available")
    }
    if (request.method !== "GET") requireSameOrigin(request)
    const tenant = await resolveRequestTenant(request.headers)
    const path = segments.join("/")
    if (segments[0] === "tenants") {
      const identity =
        segments[2] === "by-domain"
          ? requestHost(request.headers).hostname
          : tenant.slug
      if (segments.at(-1) !== identity)
        throw new PortalHttpError(404, "tenant_unavailable")
    }
    const token = sessionToken(request)
    if (token) await validateSession(token, tenant)
    const headers = new Headers({
      "X-Tenant-Id": tenant.id,
      ...ingressHeaders(request.headers),
    })
    if (token) headers.set("Authorization", `Bearer ${token}`)
    for (const name of ["accept", "accept-language", "content-type"]) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    if (allowsPreview(request.method, path)) {
      const preview = request.headers.get("x-checkout-preview-token")
      if (preview) headers.set("X-Checkout-Preview-Token", preview)
    }
    // Public endpoints accepting a tenant query must use the host's tenant too.
    if (url.searchParams.has("tenant_id"))
      url.searchParams.set("tenant_id", tenant.id)
    const body =
      request.method === "GET" ? undefined : await readBody(request, 1_048_576)
    const upstream = await backendFetch(`/api/v1/${path}${url.search}`, {
      method: request.method,
      headers,
      body: body?.byteLength ? (body as BodyInit) : undefined,
    })
    const responseHeaders = new Headers(PRIVATE_HEADERS)
    for (const name of ["content-type", "content-disposition", "retry-after"]) {
      const value = upstream.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }
    // No upstream Set-Cookie, CORS, Location or caching headers. Do not redact
    // intentional API-key creation payloads. Scoped upstream 401s are not logout.
    responseHeaders.set("X-Portal-Response", "upstream")
    return new Response(upstream.status === 204 ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
