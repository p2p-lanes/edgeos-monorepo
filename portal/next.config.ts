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
