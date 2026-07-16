import type { ReactNode } from "react"
import { Gem, type GemVariant } from "./Gem"

/**
 * Amanita skin — stepper section shell: gem separator + kicker + title +
 * optional intro copy, wrapping the section's content.
 *
 * Ported from checkout-amanita/codigo/checkout/sections.tsx (`SectionShell`).
 * Relies on the `.ck-section`, `.ck-gem*`, `.font-display`, `.font-condensed`,
 * `.text-sand`/`.text-cream` scoped utilities from amanita-skin.css (Task 3).
 */
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
