/**
 * Template ids that render content only (no product selection). Steps using one
 * of these are always visible when enabled and never resolve products. Ported
 * from `portal/src/components/checkout-flow/registries/variantRegistry.ts` —
 * keep in sync with the renderer's `CONTENT_ONLY_TEMPLATES`.
 */
export const CONTENT_ONLY_TEMPLATES: ReadonlySet<string> = new Set([
  "youtube-video",
  "image-gallery",
  "faqs",
  "rich-text",
  "hero",
])
