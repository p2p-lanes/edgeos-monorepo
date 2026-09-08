import "server-only"
import { z } from "zod"
import { resolveHostname } from "../tenant-resolution"
import { backendFetch, PortalHttpError } from "./backend"
import { requireApplicationHost } from "./ingress"

const tenantSchema = z.object({
  id: z.uuid(),
  slug: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().optional(),
  image_url: z.string().nullable().optional(),
  icon_url: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional(),
  deleted: z.boolean().optional(),
  sender_email: z.string().nullable().optional(),
  sender_name: z.string().nullable().optional(),
  custom_domain: z.string().nullable().optional(),
  custom_domain_active: z.boolean().optional(),
  meta_tracking_enabled: z.boolean().optional(),
  meta_pixel_id: z.string().nullable().optional(),
  ga_tracking_enabled: z.boolean().optional(),
  ga_measurement_id: z.string().nullable().optional(),
  help_enabled: z.boolean().optional(),
  help_email: z.string().nullable().optional(),
  landing_mode: z.enum(["portal", "checkout"]),
  active_popup_slug: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .nullable()
    .optional(),
})
export type ServerTenant = z.infer<typeof tenantSchema>

export function requestHost(headers: Headers): URL {
  const host = headers.get("host") || ""
  if (!host || /[\s,/@\\?#%]/.test(host))
    throw new PortalHttpError(400, "invalid_host")
  try {
    const url = new URL(`https://${host}`)
    if (
      url.host !== host.toLowerCase() &&
      url.host !== host.toLowerCase().replace(/:443$/, "")
    )
      throw new Error()
    return url
  } catch {
    throw new PortalHttpError(400, "invalid_host")
  }
}

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  )
}

export function trustedOrigin(headers: Headers): string {
  const host = requestHost(headers)
  // External hosts are HTTPS-only. Never infer transport trust from NODE_ENV or
  // caller-controlled forwarded headers. HTTP is supported only for loopback dev.
  return isLoopbackHost(host.hostname)
    ? new URL(`http://${headers.get("host")}`).origin
    : host.origin
}

export function requireSameOrigin(request: Request): void {
  requireApplicationHost(requestHost(request.headers).hostname)
  if (request.headers.get("origin") !== trustedOrigin(request.headers)) {
    throw new PortalHttpError(403, "origin_rejected")
  }
}

export async function resolveRequestTenant(
  headers: Headers,
): Promise<ServerTenant> {
  const host = requestHost(headers)
  requireApplicationHost(host.hostname)
  const { slug, isCustomDomain } = resolveHostname(host.hostname)
  if (!isCustomDomain && !slug)
    throw new PortalHttpError(404, "tenant_unavailable")
  const path = isCustomDomain
    ? `/api/v1/tenants/public/by-domain/${encodeURIComponent(host.hostname)}`
    : `/api/v1/tenants/public/${encodeURIComponent(slug!)}`
  // No browser Origin/Referer/X-Tenant-* is forwarded, including during failures.
  const response = await backendFetch(path)
  if (!response.ok) {
    throw new PortalHttpError(
      response.status,
      "tenant_unavailable",
      response.headers.get("retry-after"),
    )
  }
  const parsed = tenantSchema.safeParse(await response.json())
  if (!parsed.success) throw new PortalHttpError(502, "invalid_tenant_response")
  return parsed.data
}

export function stripInternalTenantHeaders(headers: Headers): Headers {
  const clean = new Headers(headers)
  for (const name of [
    "x-tenant-id",
    "x-tenant-slug",
    "x-custom-domain",
    "x-landing-mode",
    "x-active-popup-slug",
    "x-portal-route",
  ])
    clean.delete(name)
  return clean
}
