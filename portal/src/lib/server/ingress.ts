import "server-only"
import { isIP } from "node:net"
import { PortalHttpError } from "./backend"

/** ECS injects this runtime signal to identify our Fargate deployment.
 * Security depends on its already-verified ALB-only task ingress and append-mode
 * bare-IP XFF. Fargate alone is not proof that an arbitrary task uses an ALB.
 * Local and other runtimes ignore forwarding, regardless of NODE_ENV.
 */
export function trustedClientIp(headers: Headers): string | null {
  if (process.env.AWS_EXECUTION_ENV !== "AWS_ECS_FARGATE") return null
  const value = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim()
  if (!value || !isIP(value) || value.includes("%")) return null
  return value
}

export function ingressHeaders(headers: Headers): Record<string, string> {
  const ip = trustedClientIp(headers)
  return ip ? { "X-Forwarded-For": ip } : {}
}

export function isStaticHost(hostname: string): boolean {
  const hosts = new Set(["static.edgeos.world", "static-origin.edgeos.world"])
  for (const value of [
    process.env.ASSET_PREFIX,
    ...(process.env.PORTAL_STATIC_HOSTS || "").split(","),
  ]) {
    if (!value?.trim()) continue
    try {
      hosts.add(
        new URL(
          value.includes("://") ? value : `https://${value.trim()}`,
        ).hostname.toLowerCase(),
      )
    } catch {
      throw new PortalHttpError(503, "invalid_static_host_configuration")
    }
  }
  return hosts.has(hostname.toLowerCase())
}

export function requireApplicationHost(hostname: string): void {
  if (isStaticHost(hostname)) throw new PortalHttpError(404, "static_host_only")
}

export function isPublicStaticPath(path: string): boolean {
  return (
    /^\/(?:_next\/static|checkout-skins|fonts|icons|images)\//.test(path) ||
    path === "/sw.js" ||
    path === "/favicon.ico" ||
    path === "/_next/image"
  )
}
