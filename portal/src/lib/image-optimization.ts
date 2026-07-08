// Single source of truth for the hosts allowed through the Next.js image
// optimizer. next.config.ts derives `images.remotePatterns` from this list,
// so adding a CDN here is enough to enable optimization for it.
export const OPTIMIZED_IMAGE_HOSTS = [
  // Backoffice uploads (production CDN in front of storage).
  "cdn.edgeos.world",
  // INTERIM: tenants that configured popups via the API host images on raw
  // GCS buckets (e.g. egypt-eclipse). Remove once backend CDN ingestion
  // re-homes those images — this entry opens the optimizer to ANY public
  // GCS bucket, not just ours.
  "storage.googleapis.com",
  // Legacy S3 bucket — kept for older records still pointing at it.
  "simplefi.s3.us-east-2.amazonaws.com",
]

function isOptimizableImageSrc(src: string | null | undefined): boolean {
  if (!src) return false
  // Same-origin static assets are always optimizable.
  if (src.startsWith("/")) return true
  try {
    return OPTIMIZED_IMAGE_HOSTS.includes(new URL(src).hostname)
  } catch {
    return false
  }
}

/**
 * Spread onto a next/image `<Image>` whose src comes from data (tenant
 * assets, admin-entered template URLs, blob:/data: upload previews).
 * next/image throws at runtime for remote hosts missing from
 * `remotePatterns`, so unknown hosts fall back to the raw URL instead of
 * crashing the page.
 */
export function imageOptimization(src: string | null | undefined): {
  unoptimized: boolean
} {
  return { unoptimized: !isOptimizableImageSrc(src) }
}
