import type { ReactNode } from "react"
import type { TicketingStepPublic } from "@/client"
import { Gem, type GemVariant } from "./Gem"

/**
 * Amanita skin — stepper section shell: gem separator + kicker + title +
 * optional intro copy, wrapping the section's content.
 *
 * Ported from checkout-amanita/codigo/checkout/sections.tsx (`SectionShell`).
 * Relies on the `.ck-section`, `.ck-gem*`, `.font-display`, `.font-condensed`,
 * `.text-sand`/`.text-cream` scoped utilities from amanita-skin.css (Task 3).
 */
export interface ShellCopy {
  kicker?: string
  title: string
  intro?: string
}

/**
 * The heading a step shows, read from what the organizer authored in the
 * backoffice rather than from the skin.
 *
 * On Amanita the stepper suppresses its generic `SectionHeader`
 * (`contentOwnsHeader`) because every section draws its own — so a section
 * that ignores `stepConfig` is the only place the step's configured title,
 * description and watermark can go missing, and the organizer edits the step
 * with nothing on screen changing.
 *
 * A configured step owns all three: an empty description means the organizer
 * wants no intro, not that the skin should supply one. `fallback` covers the
 * step that has no config row at all. `kicker` prefers a distinct
 * `template_config.kicker`, else the watermark — never the title, which the
 * shell already prints right below it.
 *
 * These authored strings ARE translated, just not by i18next: the backend
 * overlays the `translations` row for the shopper's `Accept-Language` (which
 * portal/src/lib/api-client.ts attaches to every request) before this ever sees
 * them, so an organizer who wrote "Tus Datos" and translated it in the
 * backoffice gets "Your Details" here. `title`/`description` are registered in
 * the overlay's `TRANSLATABLE_FIELDS`; `template_config` copy is deep-merged
 * leaf by leaf. The exception is `kicker` — it is not in the overlay's
 * `_TEXT_LEAF_KEYS`, so it stays in the source language. The fallback, which
 * the caller passes already translated, follows the shopper's language too.
 */
export function shellCopy(
  stepConfig: TicketingStepPublic | null | undefined,
  fallback: ShellCopy,
): ShellCopy {
  if (!stepConfig) return fallback

  const templateConfig = (stepConfig.template_config ?? null) as Record<
    string,
    unknown
  > | null
  const templateKicker =
    typeof templateConfig?.kicker === "string" ? templateConfig.kicker : null

  return {
    kicker: templateKicker ?? stepConfig.watermark ?? undefined,
    title: stepConfig.title || fallback.title,
    intro: stepConfig.description ?? undefined,
  }
}

export function SectionShell({
  gem,
  kicker,
  title,
  intro,
  children,
}: {
  gem: GemVariant
  /** Optional — omitted (no `<p>` rendered) when there's no distinct kicker
   *  copy, so callers never fall back to repeating `title` as the kicker. */
  kicker?: string
  title: string
  intro?: string
  children: ReactNode
}) {
  return (
    <section className="ck-section pt-2">
      <Gem variant={gem} />
      <div className="mt-5 text-center">
        {kicker && (
          <p className="font-condensed text-xs font-medium uppercase tracking-[0.22em] text-sand md:text-sm">
            {kicker}
          </p>
        )}
        <h2
          className="mt-1.5 font-display uppercase leading-tight text-cream"
          style={{ fontSize: "clamp(1.7rem,4.6vw,2.4rem)" }}
        >
          {title}
        </h2>
        {intro && (
          <p
            className="mx-auto mt-2.5 max-w-[46ch] text-sm leading-relaxed md:text-base"
            style={{ color: "rgba(241,235,227,0.78)" }}
          >
            {intro}
          </p>
        )}
      </div>
      <div className="mt-8 flex flex-col gap-6 md:gap-5">{children}</div>
    </section>
  )
}
