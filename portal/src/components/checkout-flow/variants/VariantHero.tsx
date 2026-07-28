"use client"

import Image from "next/image"
import { imageOptimization } from "@/lib/image-optimization"
import type { VariantProps } from "../registries/variantRegistry"

// ---------------------------------------------------------------------------
// VariantHero
//
// Content-only step template (no products, non-purchasable — see
// CONTENT_ONLY_TEMPLATES in variantRegistry.ts). Ported from the Amanita
// mockup's `HeroSection` (checkout-amanita/codigo/checkout/sections.tsx),
// but every piece of copy AND artwork comes from
// `stepConfig.template_config` — the admin authors it in the backoffice
// (HeroConfig.tsx). This file must stay client-agnostic: no skin package
// imports, no brand hexes.
//
// Schema (`template_config`), all fields optional — render only what's
// present, never throw on an empty/undefined config:
//   {
//     "date_logo_url": "https://…",   // wordmark + date banner image
//     "edition": "string",            // edition line (e.g. "Third edition")
//     "edition_url": "https://…",     // legacy edition banner image — used only
//                                     //   when `edition` text is absent
//     "headline": "string",           // main H1
//     "subtitle": "string",           // italic tagline under the headline
//     "date_badge": "string",         // pill text (e.g. extended dates)
//     "bullets": ["string", …],       // bullet list
//     "divider_url": "https://…"      // ornament above the subtitle
//   }
//
// The bullet ornament is deliberately NOT in this schema: it's brand
// furniture, not content, so the skin owns it via `.ck-hero-bullet` (see
// amanita-skin.css) and the admin never has to re-upload the same star.
//
// `cta_label` / `cta_hint` also live in this template_config but are read by
// StepperCheckoutFlow's intro bottom bar, not by this component.
//
// The look (fonts, colors, .ck-section entrance) comes from the active skin's
// scoped CSS; this component only supplies markup + config wiring.
// ---------------------------------------------------------------------------

interface HeroConfig {
  date_logo_url?: string
  edition?: string
  edition_url?: string
  headline?: string
  subtitle?: string
  date_badge?: string
  bullets?: string[]
  divider_url?: string
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

/** Ornament above the subtitle. Classes match the mockup's `Divider`
 *  (checkout-amanita/codigo/compartidos/Ornaments.tsx) with `h-auto` added
 *  for next/image's width={0}/height={0} sizing. */
function HeroDivider({ src, eager }: { src: string; eager: boolean }) {
  return (
    <Image
      src={src}
      alt=""
      aria-hidden="true"
      width={0}
      height={0}
      sizes="(max-width: 768px) 240px, 360px"
      loading={eager ? undefined : "lazy"}
      priority={eager}
      className="mx-auto block h-auto w-full max-w-[240px] opacity-90 md:max-w-[360px]"
      {...imageOptimization(src)}
    />
  )
}

/** Bullet ornament hook. Carries no artwork or size of its own: the skin
 *  paints it through `.ck-hero-bullet` (Amanita masks its gold star.svg over
 *  it). A skin that styles nothing leaves a 0×0 span, so the bullets simply
 *  render unadorned instead of showing a stray box. */
function HeroBullet() {
  return <span aria-hidden className="ck-hero-bullet shrink-0" />
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
    config.date_logo_url ||
    config.edition ||
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
      {config.date_logo_url && (
        <HeroImage
          src={config.date_logo_url}
          alt={config.headline ?? ""}
          className="w-[min(400px,84%)]"
          eager={isFirstSection}
        />
      )}
      {config.edition ? (
        <p className="font-condensed text-sm font-semibold uppercase tracking-[0.24em] text-sand md:text-base">
          {config.edition}
        </p>
      ) : config.edition_url ? (
        <HeroImage
          src={config.edition_url}
          alt=""
          className="w-[min(240px,60%)]"
          eager={isFirstSection}
        />
      ) : null}

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
          {config.divider_url && (
            <HeroDivider src={config.divider_url} eager={isFirstSection} />
          )}
          <p className="max-w-[34ch] text-lg italic text-mint md:text-xl">
            {config.subtitle}
          </p>
        </>
      )}

      {config.date_badge && (
        <span
          className="rounded-full border px-4 py-1.5 font-condensed text-xs font-medium uppercase tracking-[0.16em] text-sand md:text-sm"
          style={{
            borderColor: "var(--hero-badge-border-color, currentColor)",
            backgroundColor: "var(--hero-badge-bg-color, transparent)",
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
              style={{ color: "var(--hero-text-color, inherit)" }}
            >
              <HeroBullet />
              {bullet}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
