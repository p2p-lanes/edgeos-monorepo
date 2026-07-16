/**
 * Amanita skin — gold brand star.
 *
 * Ported from checkout-amanita/codigo/checkout/sections.tsx (`GoldStar`).
 * star.svg is petrol-colored, so it's recolored via CSS mask + a sand
 * background instead of an <img> (same pattern as the player labels in the
 * mockup's design system) — this is a CSS-mask decorative element, not a
 * photo asset, so it stays a <span>, not next/image.
 */
export function GoldStar({
  className = "h-3.5 w-3.5",
}: {
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 ${className}`}
      style={{
        backgroundColor: "#c1aa88",
        WebkitMaskImage: "url(/checkout-skins/amanita/ornaments/star.svg)",
        maskImage: "url(/checkout-skins/amanita/ornaments/star.svg)",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  )
}
