"use client"

import parse, { Element } from "html-react-parser"
import DOMPurify from "isomorphic-dompurify"
import Image from "next/image"
import { useMemo } from "react"
import { imageOptimization } from "@/lib/image-optimization"
import type { VariantProps } from "../registries/variantRegistry"

// `isomorphic-dompurify` doesn't re-export its `Config` type, so we narrow
// to just the fields we use here rather than reaching past the public
// surface.
interface DOMPurifyConfig {
  ALLOWED_TAGS?: string[]
  ALLOWED_ATTR?: string[]
  ALLOWED_URI_REGEXP?: RegExp
}

// ---------------------------------------------------------------------------
// VariantRichText
//
// Content-only step template. The admin authors HTML (or markdown-style
// text) in the backoffice and this variant renders it sanitised — useful
// for marketing banners, hero copy, payment-method badges, anything that
// doesn't belong in a structured ticket card.
//
// Schema (`template_config`):
//   {
//     "html": "<h1>…</h1>",            // raw HTML, sanitised at render time
//     "alignment": "center" | "left",  // optional, default center
//     "max_width": "narrow" | "wide"   // optional, default wide
//   }
//
// Security: DOMPurify runs server-side AND client-side. Script tags,
// inline event handlers and `javascript:` URIs are stripped. Only the
// allowlist below survives, which is intentionally narrow.
//
// Rendering: the sanitised HTML is parsed to React elements so `<img>`
// tags whose host is allowed through the Next.js optimizer render as
// `next/image` (resized, modern formats). Images on unknown hosts stay
// as plain `<img>` with explicit loading attributes.
// ---------------------------------------------------------------------------

interface RichTextConfig {
  html?: string
  alignment?: "center" | "left"
  max_width?: "narrow" | "wide"
}

const PURIFY_CONFIG: DOMPurifyConfig = {
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
  // Disallow `javascript:` and `data:` URIs explicitly by only allowing
  // http(s), mailto, tel, fragment and root-relative paths.
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|#|\/)/,
}

const ALIGNMENT_CLASSES: Record<
  NonNullable<RichTextConfig["alignment"]>,
  string
> = {
  center: "text-center mx-auto",
  left: "text-left",
}

const WIDTH_CLASSES: Record<
  NonNullable<RichTextConfig["max_width"]>,
  string
> = {
  narrow: "max-w-md",
  wide: "max-w-3xl",
}

// Loading attributes are injected AFTER sanitisation (they are not in
// ALLOWED_ATTR, so admin-authored values are always stripped first).
// Below-the-fold images load lazily so multi-MB content images don't
// compete with the LCP for bandwidth; first-section images are LCP
// candidates and load eagerly with high fetch priority instead.
// NOTE: these attrs only survive on the plain-<img> fallback path — imgs
// on optimizer-allowed hosts are replaced by next/image in richTextImage
// below, which expresses the same intent via its `priority` prop.
function withImageLoadingAttrs(
  sanitizedHtml: string,
  isFirstSection: boolean,
): string {
  const attrs = isFirstSection
    ? 'fetchpriority="high" decoding="async"'
    : 'loading="lazy" decoding="async"'
  return sanitizedHtml.replaceAll("<img ", `<img ${attrs} `)
}

// Swap an authored <img> for next/image when its host is allowed through
// the optimizer. Returning undefined keeps the sanitised <img> untouched
// (it already carries the loading attributes injected above) — that is
// the right call for unknown hosts, which next/image rejects at runtime.
function richTextImage(node: Element, isFirstSection: boolean) {
  const { src, alt, width, height, class: className } = node.attribs
  if (!src || imageOptimization(src).unoptimized) {
    return undefined
  }
  const w = Number.parseInt(width ?? "", 10)
  const h = Number.parseInt(height ?? "", 10)
  const hasDims = w > 0 && h > 0
  return (
    <Image
      src={src}
      alt={alt ?? ""}
      // Without authored dimensions next/image still needs a ratio to
      // reserve space; 4:3 placeholder + h-auto lets the real ratio take
      // over once loaded — no worse than the zero reservation a plain
      // <img> without dimensions gets.
      width={hasDims ? w : 1200}
      height={hasDims ? h : 900}
      sizes="(max-width: 768px) 100vw, 768px"
      priority={isFirstSection}
      className={
        hasDims ? className : `${className ?? ""} h-auto w-full`.trim()
      }
    />
  )
}

export default function VariantRichText({
  templateConfig,
  isFirstSection = false,
}: VariantProps) {
  const config = (templateConfig ?? {}) as RichTextConfig
  const html = typeof config.html === "string" ? config.html : ""

  const content = useMemo(() => {
    const sanitized = withImageLoadingAttrs(
      DOMPurify.sanitize(html, PURIFY_CONFIG),
      isFirstSection,
    )
    if (!sanitized) return null
    return parse(sanitized, {
      replace: (node) => {
        if (node instanceof Element && node.name === "img") {
          return richTextImage(node, isFirstSection)
        }
        return undefined
      },
    })
  }, [html, isFirstSection])

  if (!content) {
    return null
  }

  return (
    <div
      className={`${WIDTH_CLASSES[config.max_width ?? "wide"]} ${
        ALIGNMENT_CLASSES[config.alignment ?? "center"]
      } prose prose-invert prose-headings:font-semibold prose-a:underline`}
    >
      {content}
    </div>
  )
}
