import { Stars } from "./Stars"

/**
 * Amanita skin — fixed full-viewport background layer: forest photo + navy
 * gradient veil + brand star texture + twinkling Stars overlay.
 *
 * Ported from the `<div aria-hidden className="fixed inset-0 z-0">` block in
 * checkout-amanita/codigo/checkout/CheckoutExperience.tsx. The mockup's
 * art-directed `<picture>`/`<source media="(max-width: 767px)">` swap
 * (mobile vs. desktop crop) is reproduced verbatim with a native
 * `<picture>` + plain `<img>` rather than two `next/image` elements: two
 * `fill` Images toggled via `md:` classes both got `priority`, so the
 * browser preloaded/downloaded BOTH crops on every viewport. A `<picture>`
 * only ever fetches the one matching source, so this is both simpler and
 * avoids the double download — a legitimate use of raw `<img>` for a
 * decorative, full-bleed, art-directed background image.
 *
 * `pointer-events-none` is load-bearing, not tidying: the checkout scrolls in
 * `CheckoutPageClient`'s `main.h-svh.overflow-y-auto`, but a fixed element's
 * scroll chain starts at the viewport, not at the overflow ancestor it happens
 * to sit in — and the document itself doesn't scroll. Hit-testable, this layer
 * swallows the wheel everywhere it isn't covered by the content column, so the
 * page only scrolls with the cursor over the cards. The sibling non-amanita
 * backgrounds dodge this by painting at `-z-10`, behind the scroller's own box.
 */
export function AmanitaBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      <picture>
        <source
          media="(max-width: 767px)"
          srcSet="/checkout-skins/amanita/artist-hero-bg-mobile.webp"
        />
        <img
          src="/checkout-skins/amanita/artist-hero-bg.webp"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      </picture>
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
