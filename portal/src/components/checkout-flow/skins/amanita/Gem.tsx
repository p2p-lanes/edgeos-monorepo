/**
 * Amanita skin — gem separator between section blocks.
 *
 * Extracted from the inline `ck-gem` markup in `SectionShell` in
 * checkout-amanita/codigo/checkout/sections.tsx. Recolored via CSS mask
 * (`.ck-gem-*` rules in amanita-skin.css): the sep-gem-*.webp files are RGB
 * with a black background, so the mask runs in luminance mode — black
 * becomes transparent and the gem paints as a solid cream shape (a "png
 * effect"). This is a CSS-mask decorative element, not a photo asset, so it
 * stays a plain <div>, not next/image.
 */
export type GemVariant = "bold" | "mid" | "thin" | "flourish"

export function Gem({ variant }: { variant: GemVariant }) {
  return (
    <div
      aria-hidden
      className={`ck-gem ck-gem-${variant} pointer-events-none mx-auto w-[min(420px,80%)] bg-cream md:w-[380px]`}
    />
  )
}
