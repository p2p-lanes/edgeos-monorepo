import path from "node:path"
import type { NextConfig } from "next"
import { OPTIMIZED_IMAGE_HOSTS } from "./src/lib/image-optimization"

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  // CDN for /_next/static chunks (e.g. https://static.edgeos.world). One
  // static domain serves every tenant custom domain, so immutable assets get
  // edge caching without per-tenant certificates or DNS. Unset = same-origin.
  assetPrefix: process.env.ASSET_PREFIX || undefined,
  // Fonts fetched through the assetPrefix CDN are cross-origin and require
  // CORS. Baking the header into the origin response means the CDN caches it
  // inside the object, instead of depending on per-request edge policy
  // evaluation.
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
      // Skin art reached from a stylesheet resolves against the CDN, not the
      // tenant domain, so it is cross-origin for the same reason fonts are.
      // Chrome fetches `mask-image` in CORS mode (`background-image` it does
      // not), so without this the masked pieces — the hero bullet star, the
      // `.ck-gem-*` separators — silently paint nothing while the plain
      // backgrounds beside them load fine.
      {
        source: "/checkout-skins/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ]
  },
  transpilePackages: ["@edgeos/shared-form-ui", "@edgeos/shared-events"],
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  },
  images: {
    remotePatterns: OPTIMIZED_IMAGE_HOSTS.map((hostname) => ({
      protocol: "https" as const,
      hostname,
    })),
    // WebP only: AVIF shaves a few KB but its encode costs seconds of
    // server CPU on every cold (image, width) variant, which shows up as
    // 1-3s first renders in carousels and lightboxes. Sources are already
    // compressed WebP at upload time, so AVIF's marginal savings never pay
    // for that latency.
    formats: ["image/webp"],
  },
}

export default nextConfig
