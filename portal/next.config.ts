import path from "node:path"
import type { NextConfig } from "next"
import { OPTIMIZED_IMAGE_HOSTS } from "./src/lib/image-optimization"

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname, ".."),
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
    // AVIF first (best compression for the photographic tenant imagery),
    // WebP fallback for browsers without AVIF support.
    formats: ["image/avif", "image/webp"],
  },
}

export default nextConfig
