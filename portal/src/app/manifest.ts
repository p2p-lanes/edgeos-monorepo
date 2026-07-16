import type { MetadataRoute } from "next"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"

const FALLBACK_NAME = "Edge Portal"
const FALLBACK_SHORT_NAME = "Edge"
const FALLBACK_DESCRIPTION =
  "Access your pop-up city events, passes, and applications."

const DEFAULT_ICONS: MetadataRoute.Manifest["icons"] = [
  {
    src: "/icons/icon-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/icons/icon-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/icons/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
]

function tenantIcons(iconUrl: string): MetadataRoute.Manifest["icons"] {
  return [
    { src: iconUrl, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: iconUrl, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: iconUrl, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ]
}

// Served by Next at /manifest.webmanifest. Linked only from /portal routes
// (see portal/layout.tsx). Scoped to /portal so checkout never triggers install.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const tenant = await resolveTenantForMetadata()

  const name = tenant?.name ? `${tenant.name} Portal` : FALLBACK_NAME
  const shortName = tenant?.name ?? FALLBACK_SHORT_NAME
  const description = tenant?.name
    ? `Access ${tenant.name} events, passes, and applications.`
    : FALLBACK_DESCRIPTION

  return {
    name,
    short_name: shortName,
    description,
    start_url: "/portal",
    scope: "/portal",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: tenant?.icon_url ? tenantIcons(tenant.icon_url) : DEFAULT_ICONS,
  }
}
