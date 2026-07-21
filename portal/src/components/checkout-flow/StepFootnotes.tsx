"use client"

/**
 * A step's "Footer Note" (`template_config.footer_text`), rendered below its
 * content — and below its FAQs, when it has them.
 *
 * ScrollyCheckoutFlow has drawn this since it was added, but the stepper never
 * did, so a note authored for a stepper checkout simply never appeared. This
 * is the stepper's renderer for it.
 *
 * The Amanita branch is ported from the mockup's `footnotes` block
 * (checkout-amanita/codigo/checkout/sections.tsx, the centred asterisked
 * clarifications under the Extras cards). The mockup models them as a
 * `string[]`, one <p> each; the backoffice authors a single multi-line
 * Textarea, so a line here is a footnote there — the same "one per line"
 * convention the confirm step's insurance `benefits` field already uses.
 */
import type { CheckoutSkin } from "@/lib/checkout-skin"

/**
 * Split a Footer Note into the mockup's per-line footnotes.
 *
 * Leading bullets are stripped because Amanita prints its own "*" — an
 * organizer who types the asterisk they can see in the design would otherwise
 * get "* * No hay reembolsos".
 */
export function parseFootnotes(
  templateConfig: Record<string, unknown> | null | undefined,
): string[] {
  const raw = templateConfig?.footer_text
  if (typeof raw !== "string") return []
  return raw
    .split("\n")
    .map((line) => line.replace(/^\s*[*•-]\s*/, "").trim())
    .filter(Boolean)
}

export default function StepFootnotes({
  skin,
  templateConfig,
}: {
  skin: CheckoutSkin
  templateConfig: Record<string, unknown> | null | undefined
}) {
  const footnotes = parseFootnotes(templateConfig)
  if (footnotes.length === 0) return null

  if (skin === "amanita") {
    return (
      <div className="mt-6 flex flex-col gap-1.5 text-center">
        {footnotes.map((note) => (
          <p
            key={note}
            className="text-xs leading-relaxed"
            style={{ color: "rgba(241,235,227,0.66)" }}
          >
            * {note}
          </p>
        ))}
      </div>
    )
  }

  /* The unskinned note, kept identical to the one ScrollyCheckoutFlow already
     draws so the two funnels don't disagree about what a Footer Note looks
     like. */
  return (
    <div className="mx-auto w-full max-w-2xl">
      {footnotes.map((note) => (
        <p
          key={note}
          className="text-xs text-gray-400 leading-relaxed px-1 pt-4 text-center"
        >
          {note}
        </p>
      ))}
    </div>
  )
}
