export const CONTENT_ONLY_TEMPLATES = new Set([
  "youtube-video",
  "image-gallery",
  "faqs",
  "rich-text",
  "hero",
])

/** Templates whose data source is not the checkout product catalog. */
export const PRODUCT_INDEPENDENT_TEMPLATES = new Set([
  ...CONTENT_ONLY_TEMPLATES,
  "accommodation-booking",
])
