"use client"

/**
 * Amanita skin — brand header above the landing step.
 *
 * This is the top block of the mockup's `HeroSection` (wordmark + date
 * banner, edition banner, headline), moved out of the standalone "Home"
 * step and onto the first product step: with the Home step gone from the
 * flow, Entradas is what the shopper lands on, and the festival still has
 * to introduce itself before it starts selling.
 *
 * The markup mirrors VariantHero's three corresponding blocks so the two
 * render identically — only the full-viewport centering is dropped, since
 * this is a header above the catalog rather than a screen of its own, and
 * the hero's closing ornament is dropped too: SectionShell's <Gem> already
 * draws that exact rule directly below.
 *
 * Unlike VariantHero, nothing here is authored in the backoffice. The
 * artwork is the skin's own (portal/public/checkout-skins/amanita, the same
 * place logo-hongo.webp is read from) and the headline is a
 * `checkout.amanita.*` string, translated alongside the rest of the skin's
 * copy — this block is brand furniture, not step content.
 */
import Image from "next/image"
import { useTranslation } from "react-i18next"

const DATE_LOGO = "/checkout-skins/amanita/logo-fecha.webp"
const EDITION = "/checkout-skins/amanita/tercera-edicion.webp"

export function AmanitaHero() {
  const { t } = useTranslation()
  const headline = t("checkout.amanita.hero_headline")

  return (
    <section className="ck-section flex flex-col items-center gap-5 pt-2 pb-2 text-center">
      <Image
        src={DATE_LOGO}
        alt={headline}
        width={551}
        height={244}
        sizes="(max-width: 768px) 84vw, 400px"
        priority
        className="h-auto w-[min(400px,84%)]"
      />
      <Image
        src={EDITION}
        alt=""
        aria-hidden
        width={437}
        height={82}
        sizes="(max-width: 768px) 60vw, 240px"
        priority
        className="h-auto w-[min(240px,60%)]"
      />
      <h1
        className="max-w-[22ch] font-display uppercase leading-tight text-cream"
        style={{ fontSize: "clamp(1.75rem,5.4vw,2.7rem)" }}
      >
        {headline}
      </h1>
    </section>
  )
}
