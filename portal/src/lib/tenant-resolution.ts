/**
 * Tenant resolution utilities.
 *
 * Pure, synchronous, no I/O — safe to call from Next.js middleware (Edge
 * Runtime) and from SSR / client code alike.
 */

export interface HostResolution {
  /** Tenant slug extracted from subdomain, or null for custom domains. */
  slug: string | null
  /** True when the host is a custom domain (not a platform subdomain). */
  isCustomDomain: boolean
}

/**
 * Resolve a hostname to either a tenant slug (subdomain path) or a flag
 * indicating that the host needs backend resolution.
 *
 * Behaviour depends on the `CUSTOM_DOMAINS_ENABLED` env var:
 *
 * - **disabled** (default): always performs subdomain extraction; no API
 *   calls are ever made.  Self-hosters work without any extra configuration.
 * - **enabled** (`CUSTOM_DOMAINS_ENABLED=true`): ALL hosts are routed
 *   through the backend `by-domain` endpoint, which resolves in order:
 *   (1) `custom_domain` field, (2) slug extracted from `*.PORTAL_DOMAIN`
 *   subdomains.  This prevents a tenant whose `custom_domain` is set to a
 *   `*.edgeos.world` subdomain from being incorrectly resolved via fast-path
 *   slug extraction.
 */
export function resolveHostname(host: string): HostResolution {
  const customDomainsEnabled = process.env.CUSTOM_DOMAINS_ENABLED === "true"

  if (!customDomainsEnabled) {
    // Feature is disabled — always fall back to subdomain extraction so that
    // existing behaviour is fully preserved.
    const slug = extractSubdomainSlug(host)
    return { slug, isCustomDomain: false }
  }

  // Feature on: backend resolves everything (covers custom domains AND
  // *.PORTAL_DOMAIN subdomains) — no fast-path slug extraction on the portal.
  return { slug: null, isCustomDomain: true }
}

/** Extract the leftmost label of a hostname as the tenant slug. */
function extractSubdomainSlug(host: string): string | null {
  const bare = host.split(":")[0] ?? ""
  const parts = bare.split(".")
  const first = parts[0]
  if (parts.length >= 2 && first && first !== "www") {
    return first
  }
  return null
}
