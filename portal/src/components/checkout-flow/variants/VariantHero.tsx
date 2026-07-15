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
//     "logo_url": "https://…",        // brand mark (top)
//     "date_logo_url": "https://…",   // wordmark + date banner image
//     "edition_url": "https://…",     // edition banner image (e.g. "3rd ed.")
//     "headline": "string",           // main H1
//     "subtitle": "string",           // italic tagline under the headline
//     "date_badge": "string",         // pill text (e.g. extended dates)
//     "bullets": ["string", …],       // bullet list
//     "bullet_icon_url": "https://…", // bullet ornament (CSS mask, see below)
//     "divider_url": "https://…"      // ornament above the subtitle
//   }
//
// `cta_label` / `cta_hint` also live in this template_config but are read by
// StepperCheckoutFlow's intro bottom bar, not by this component.
//
// The look (fonts, colors, .ck-section entrance) comes from the active skin's
// scoped CSS; this component only supplies markup + config wiring.
// ---------------------------------------------------------------------------

interface HeroConfig {
  logo_url?: string
  date_logo_url?: string
  edition_url?: string
  headline?: string
  subtitle?: string
  date_badge?: string
  bullets?: string[]
  bullet_icon_url?: string
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

/** Bullet ornament. Stays a CSS-masked <span> rather than an <img> because
 *  ornament artwork is typically a single-color SVG that must be recolored to
 *  the skin's palette (the mockup's star.svg is petrol on a navy page). The
 *  tint comes from the skin via `--hero-bullet-color`; skins that don't set it
 *  fall back to the surrounding text color. */
function HeroBullet({ src }: { src: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 shrink-0"
      style={{
        backgroundColor: "var(--hero-bullet-color, currentColor)",
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
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
              {config.bullet_icon_url && (
                <HeroBullet src={config.bullet_icon_url} />
              )}
              {bullet}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
