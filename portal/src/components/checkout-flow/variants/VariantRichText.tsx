"use client"

import DOMPurify from "isomorphic-dompurify"
import { useMemo } from "react"
import type { VariantProps } from "../registries/variantRegistry"

// ---------------------------------------------------------------------------
// VariantRichText
//
// Content-only template. The tenant authors HTML or markdown in the
// backoffice and this variant renders it sanitized. Useful for the
// "marketing banner" use case: hero text, decorative copy, payment-method
// badges, anything that doesn't belong in a structured ticket card.
//
// Schema (`template_config`):
//   {
//     "html": "<h1>...</h1>",          // raw HTML (sanitized at render time)
//     "alignment": "center" | "left",  // optional, default center
//     "max_width": "narrow" | "wide"   // optional, default wide
//   }
//
// Security: DOMPurify is run server-side and client-side. Script tags,
// inline event handlers and javascript: URIs are stripped. Trusted tags
// for marketing markup (h1-h6, p, strong, em, ul, ol, li, a, img, br, hr,
// blockquote, span, div) are allowed.
// ---------------------------------------------------------------------------

interface RichTextConfig {
  html?: string
  alignment?: "center" | "left"
  max_width?: "narrow" | "wide"
}

const PURIFY_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "strong",
    "em",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "a",
    "img",
    "br",
    "hr",
    "blockquote",
    "span",
    "div",
    "section",
    "small",
    "code",
  ],
  ALLOWED_ATTR: [
    "href",
    "src",
    "alt",
    "title",
    "class",
    "style",
    "target",
    "rel",
    "width",
    "height",
  ],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|#|\/)/,
}

const ALIGNMENT_CLASSES: Record<NonNullable<RichTextConfig["alignment"]>, string> = {
  center: "text-center mx-auto",
  left: "text-left",
}

const WIDTH_CLASSES: Record<NonNullable<RichTextConfig["max_width"]>, string> = {
  narrow: "max-w-md",
  wide: "max-w-3xl",
}

export default function VariantRichText({ templateConfig }: VariantProps) {
  const config = (templateConfig ?? {}) as RichTextConfig
  const html = typeof config.html === "string" ? config.html : ""

  const sanitized = useMemo(() => DOMPurify.sanitize(html, PURIFY_CONFIG), [html])

  if (!sanitized) {
    return null
  }

  return (
    <div
      className={`${WIDTH_CLASSES[config.max_width ?? "wide"]} ${
        ALIGNMENT_CLASSES[config.alignment ?? "center"]
      } prose prose-invert prose-headings:font-semibold prose-a:underline`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by DOMPurify with strict allowlist above
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  )
}
