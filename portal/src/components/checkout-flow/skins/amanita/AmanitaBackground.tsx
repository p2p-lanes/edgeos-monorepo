import Image from "next/image"
import { imageOptimization } from "@/lib/image-optimization"
import { Stars } from "./Stars"

/**
 * Amanita skin — fixed full-viewport background layer: forest photo + navy
 * gradient veil + brand star texture + twinkling Stars overlay.
 *
 * Ported from the `<div aria-hidden className="fixed inset-0 z-0">` block in
 * checkout-amanita/codigo/checkout/CheckoutExperience.tsx. The mockup's
 * `<picture>`/`<source media="(max-width: 767px)">` art direction (mobile
 * vs. desktop crop) doesn't have a next/image equivalent, so it's
 * reproduced with two `fill` Image elements toggled via the same `md:`
 * breakpoint Tailwind/next.js use by default (768px), matching the
 * mockup's 767px cutoff.
 */
export function AmanitaBackground() {
  return (
    <div aria-hidden className="fixed inset-0 z-0">
      <div className="absolute inset-0 md:hidden">
        <Image
          src="/checkout-skins/amanita/artist-hero-bg-mobile.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
          {...imageOptimization(
            "/checkout-skins/amanita/artist-hero-bg-mobile.webp",
          )}
        />
      </div>
      <div className="absolute inset-0 hidden md:block">
        <Image
          src="/checkout-skins/amanita/artist-hero-bg.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
          {...imageOptimization("/checkout-skins/amanita/artist-hero-bg.webp")}
        />
      </div>
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(4,34,49,0.78) 0%, rgba(3,25,37,0.86) 45%, rgba(1,15,22,0.93) 100%)",
        }}
      />
      {/* brand star texture over the veil */}
      <div className="dark-stars absolute inset-0" />
      <Stars dim />
    </div>
  )
}
