import Image from "next/image"
import type { ReactNode } from "react"
import { imageOptimization } from "@/lib/image-optimization"

/**
 * Amanita skin — ornamental system (Divider + CornerFrame).
 *
 * Ported from checkout-amanita/codigo/compartidos/Ornaments.tsx. Only the
 * two pieces the checkout flow uses (`Divider`, `CornerFrame`) are ported —
 * `FlourishTitle`/`StarList`/`Star` aren't used by the checkout stepper.
 * These are real raster decorative assets (not CSS masks), so raw <img> is
 * swapped for next/image + imageOptimization(), matching the
 * ScrollySectionNav.tsx convention. Intrinsic width/height below were read
 * from the actual files under portal/public/checkout-skins/amanita/ornaments
 * so next/image can compute layout without CLS.
 */

const O = "/checkout-skins/amanita/ornaments"

type DividerVariant = "gold" | "cream" | "small"

const DIVIDER_ASSET: Record<
  DividerVariant,
  { src: string; width: number; height: number }
> = {
  gold: { src: `${O}/divider-1.webp`, width: 900, height: 47 }, // sand/gold — cream sections
  cream: { src: `${O}/divider-1-dark.webp`, width: 659, height: 34 }, // cream — navy sections
  small: { src: `${O}/divider-2.webp`, width: 368, height: 42 }, // compact petrol
}

export function Divider({
  variant = "gold",
  eager = false,
  className = "",
}: {
  variant?: DividerVariant
  /** true only if above-the-fold */
  eager?: boolean
  className?: string
}) {
  const { src, width, height } = DIVIDER_ASSET[variant]
  return (
    <Image
      src={src}
      alt=""
      aria-hidden="true"
      width={width}
      height={height}
      loading={eager ? undefined : "lazy"}
      priority={eager}
      className={`mx-auto block w-full opacity-90 ${
        variant === "small"
          ? "max-w-[160px] md:max-w-[200px]"
          : "max-w-[240px] md:max-w-[360px]"
      } ${className}`}
      {...imageOptimization(src)}
    />
  )
}

const CORNER_BL = { src: `${O}/corner-bl.webp`, width: 188, height: 130 }
const CORNER_TR = { src: `${O}/corner-tr.webp`, width: 246, height: 242 }

/** Art-nouveau corner frame (highlighted blocks: tickets, confirm summary). */
export function CornerFrame({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <Image
        src={CORNER_BL.src}
        alt=""
        aria-hidden="true"
        width={CORNER_BL.width}
        height={CORNER_BL.height}
        loading="lazy"
        className="pointer-events-none absolute -bottom-1 -left-1 w-20 opacity-80 md:w-28"
        {...imageOptimization(CORNER_BL.src)}
      />
      <Image
        src={CORNER_TR.src}
        alt=""
        aria-hidden="true"
        width={CORNER_TR.width}
        height={CORNER_TR.height}
        loading="lazy"
        className="pointer-events-none absolute -right-1 -top-1 w-20 opacity-80 md:w-28"
        {...imageOptimization(CORNER_TR.src)}
      />
      {children}
    </div>
  )
}
