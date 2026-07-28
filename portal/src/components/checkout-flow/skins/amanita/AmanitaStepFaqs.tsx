"use client"

/**
 * Amanita skin — a step's own FAQs, rendered below its content.
 *
 * Ported from the mockup's per-section questions block
 * (checkout-amanita/codigo/checkout/sections.tsx: the `section.faqs` branch of
 * `CatalogSectionView`, which puts "Preguntas sobre el acampe" under the
 * Alojamiento cards). The mockup hardcoded those questions per section; here
 * any step can carry its own, authored in the backoffice's "FAQs" card and
 * stored under `template_config.faqs`.
 *
 * Nested under `faqs` rather than the top-level `items` the `faqs` *template*
 * uses for the global drawer, so a step can't collide with itself.
 */
import FaqList, { type FaqItem } from "./FaqList"
import { GoldStar } from "./GoldStar"

interface StepFaqs {
  title?: string
  items: FaqItem[]
}

/**
 * `template_config` is unvalidated JSON (the backend stores it as free JSONB),
 * so this parses defensively — same posture as VariantFaqs' `parseFaqs` and
 * StepperCheckoutFlow's `parseFaqDrawerItems`. Items with no question are
 * dropped: an authored-but-empty row is a half-finished edit, not content, and
 * rendering it would put a bare chevron on the page.
 */
export function parseStepFaqs(
  templateConfig: Record<string, unknown> | null | undefined,
): StepFaqs | null {
  const raw = templateConfig?.faqs
  if (!raw || typeof raw !== "object") return null

  const record = raw as Record<string, unknown>
  if (!Array.isArray(record.items)) return null

  const items = (record.items as Array<Record<string, unknown>>)
    .map((item) => ({
      question: typeof item?.question === "string" ? item.question.trim() : "",
      answer: typeof item?.answer === "string" ? item.answer : "",
    }))
    .filter((item) => item.question)
  if (items.length === 0) return null

  const title = typeof record.title === "string" ? record.title.trim() : ""
  return { title: title || undefined, items }
}

export default function AmanitaStepFaqs({
  templateConfig,
}: {
  templateConfig: Record<string, unknown> | null | undefined
}) {
  const faqs = parseStepFaqs(templateConfig)
  if (!faqs) return null

  return (
    /* `mt-8` stands in for the `gap-6` this block would inherit as SectionShell's
       last child in the mockup — it renders after the shell here so that every
       step type gets it, not just the catalog ones. */
    <div className="mt-8">
      {faqs.title && (
        <div className="flex items-center justify-center gap-2.5">
          <GoldStar className="h-3 w-3" />
          <h3 className="font-display text-lg uppercase tracking-wide text-cream md:text-xl">
            {faqs.title}
          </h3>
          <GoldStar className="h-3 w-3" />
        </div>
      )}
      <div className={faqs.title ? "mt-4" : ""}>
        <FaqList items={faqs.items} />
      </div>
    </div>
  )
}
