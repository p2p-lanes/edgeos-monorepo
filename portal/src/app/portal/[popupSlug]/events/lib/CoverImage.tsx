"use client"

import { useEffect, useState } from "react"

interface CoverImageProps {
  src: string | null | undefined
  alt: string
  className?: string
  fallback: React.ReactNode
}

/**
 * Renders a cover image with a graceful placeholder when src is missing
 * OR when the network load fails. The placeholder is centered on a muted
 * background with whatever node the caller passes (typically a lucide
 * icon sized for the slot).
 */
export function CoverImage({
  src,
  alt,
  className,
  fallback,
}: CoverImageProps) {
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    setErrored(false)
  }, [src])

  if (!src || errored) {
    return (
      <div
        aria-label={alt}
        className={`flex items-center justify-center bg-muted ${className ?? ""}`}
      >
        {fallback}
      </div>
    )
  }

  return (
    // biome-ignore lint/performance/noImgElement: portal uses plain imgs for cover photos uploaded to S3
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setErrored(true)}
    />
  )
}
