import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@edgeos/utils", "@edgeos/api-client"],
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
