"use client"

import Image from "next/image"
import { useRef, useState } from "react"
import { imageOptimization } from "@/lib/image-optimization"

interface CoverImageProps {
  src: string | null | undefined
  alt: string
  className?: string
  /**
   * Rendered width hint for the optimizer. Callers size the image purely
   * via CSS classes, so pass the slot's real width (e.g. "64px" for list
   * thumbnails) to avoid over-fetching.
   */
  sizes?: string
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
  sizes = "100vw",
  fallback,
}: CoverImageProps) {
  const [errored, setErrored] = useState(false)
  // Reset the error flag during render when src changes — preferred over
  // useEffect per the React docs ("Adjusting state when a prop changes"),
  // and keeps the dependency-list lint quiet.
  const prevSrcRef = useRef(src)
  if (prevSrcRef.current !== src) {
    prevSrcRef.current = src
    setErrored(false)
  }

  if (!src || errored) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex items-center justify-center bg-muted ${className ?? ""}`}
      >
        {fallback}
      </div>
    )
  }

  return (
    // Callers control the rendered size through `className`, so width and
    // height are zeroed out and only feed the optimizer via `sizes`.
    <Image
      src={src}
      alt={alt}
      width={0}
      height={0}
      sizes={sizes}
      className={className}
      onError={() => setErrored(true)}
      {...imageOptimization(src)}
    />
  )
}
