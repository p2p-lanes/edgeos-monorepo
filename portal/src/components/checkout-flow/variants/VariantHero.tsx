"use client"

import Image from "next/image"
import { imageOptimization } from "@/lib/image-optimization"
import type { VariantProps } from "../registries/variantRegistry"
import { GoldStar } from "../skins/amanita/GoldStar"
import { Divider } from "../skins/amanita/Ornaments"

// ---------------------------------------------------------------------------
// VariantHero
//
// Content-only step template (no products, non-purchasable — see
// CONTENT_ONLY_TEMPLATES in variantRegistry.ts). Ported from the Amanita
// mockup's `HeroSection` (checkout-amanita/codigo/checkout/sections.tsx),
// but every piece of copy/artwork comes from `stepConfig.template_config`
// instead of being hardcoded — the admin authors it in the backoffice
// (Plan 4). The Amanita look (fonts, colors, .ck-section entrance) comes
// from the scoped `.checkout-amanita` CSS (Task 3); this component only
// supplies the markup + config wiring.
//
// Schema (`template_config`), all fields optional — render only what's
// present, never throw on an empty/undefined config:
//   {
//     "logo_url": "https://…",       // brand mark (top)
//     "date_logo_url": "https://…",  // wordmark + date banner image
//     "edition_url": "https://…",    // edition banner image (e.g. "3rd ed.")
//     "headline": "string",          // main H1
//     "subtitle": "string",          // italic tagline under the headline
//     "date_badge": "string",        // pill text (e.g. extended dates)
//     "bullets": ["string", …]       // GoldStar bullet list
//   }
//
// Images: sourced from config URLs via next/image + imageOptimization()
// (unknown hosts fall back to `unoptimized`, same as the other variants/
// primitives). No mockup asset defaults are wired in — an admin who wants
// the Amanita mockup art simply points `logo_url`/`date_logo_url`/
// `edition_url` at the already-ported `/checkout-skins/amanita/…` files.
// ---------------------------------------------------------------------------

interface HeroConfig {
  logo_url?: string
  date_logo_url?: string
  edition_url?: string
  headline?: string
  subtitle?: string
  date_badge?: string
  bullets?: string[]
}

function HeroImage({
  src,
  alt,
  className,
  eager,
}: {
  src: string
  alt: string
  className: string
  eager: boolean
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={0}
      height={0}
      sizes="(max-width: 768px) 84vw, 400px"
      loading={eager ? undefined : "lazy"}
      priority={eager}
      className={`h-auto ${className}`}
      {...imageOptimization(src)}
    />
  )
}

export default function VariantHero({
  templateConfig,
  isFirstSection = false,
}: VariantProps) {
  const config = (templateConfig ?? {}) as HeroConfig

  const bullets = Array.isArray(config.bullets)
    ? config.bullets.filter(
        (b): b is string => typeof b === "string" && b.length > 0,
      )
    : []

  const hasAnyContent =
    config.logo_url ||
    config.date_logo_url ||
    config.edition_url ||
    config.headline ||
    config.subtitle ||
    config.date_badge ||
    bullets.length > 0

  if (!hasAnyContent) {
    return null
  }

  return (
    <section className="ck-section flex min-h-[calc(100dvh-230px)] flex-col items-center justify-center gap-5 py-6 text-center">
      {config.logo_url && (
        <HeroImage
          src={config.logo_url}
          alt=""
          className="w-[min(240px,60%)]"
          eager={isFirstSection}
        />
      )}
      {config.date_logo_url && (
        <HeroImage
          src={config.date_logo_url}
          alt={config.headline ?? ""}
          className="w-[min(400px,84%)]"
          eager={isFirstSection}
        />
      )}
      {config.edition_url && (
        <HeroImage
          src={config.edition_url}
          alt=""
          className="w-[min(240px,60%)]"
          eager={isFirstSection}
        />
      )}

      {config.headline && (
        <h1
          className="max-w-[22ch] font-display uppercase leading-tight text-cream"
          style={{ fontSize: "clamp(1.75rem,5.4vw,2.7rem)" }}
        >
          {config.headline}
        </h1>
      )}

      {config.subtitle && (
        <>
          <Divider variant="cream" eager={isFirstSection} />
          <p className="max-w-[34ch] text-lg italic text-mint md:text-xl">
            {config.subtitle}
          </p>
        </>
      )}

      {config.date_badge && (
        <span
          className="rounded-full border px-4 py-1.5 font-condensed text-xs font-medium uppercase tracking-[0.16em] text-sand md:text-sm"
          style={{
            borderColor: "rgba(193,170,136,0.55)",
            backgroundColor: "rgba(193,170,136,0.12)",
          }}
        >
          {config.date_badge}
        </span>
      )}

      {bullets.length > 0 && (
        <ul className="mt-1 flex flex-col items-start gap-2.5">
          {bullets.map((bullet) => (
            <li
              key={bullet}
              className="flex items-center gap-2.5 text-sm md:text-base"
              style={{ color: "rgba(241,235,227,0.85)" }}
            >
              <GoldStar />
              {bullet}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
