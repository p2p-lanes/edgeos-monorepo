import path from "node:path"
import type { NextConfig } from "next"

const isVercel = process.env.VERCEL === "1"

const nextConfig: NextConfig = {
  ...(isVercel
    ? {}
    : {
        output: "standalone",
        outputFileTracingRoot: path.resolve(__dirname, ".."),
      }),
  transpilePackages: ["@edgeos/shared-form-ui", "@edgeos/shared-events"],
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  },
  images: {
    remotePatterns: [
      {
        hostname: "simplefi.s3.us-east-2.amazonaws.com",
      },
    ],
    unoptimized: true,
  },
}

export default nextConfig
