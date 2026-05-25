import { useRef, useState } from "react"

interface CoverImageProps {
  src: string | null | undefined
  alt: string
  className?: string
  fallback: React.ReactNode
}

/**
 * Renders a cover image with a graceful placeholder when src is missing
 * OR when the network load fails.
 */
export function CoverImage({ src, alt, className, fallback }: CoverImageProps) {
  const [errored, setErrored] = useState(false)
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
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setErrored(true)}
    />
  )
}
