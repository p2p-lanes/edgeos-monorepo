"use client"

/**
 * Amanita skin — the FAQ accordion, a 1:1 port of the mockup's `FaqList`
 * (checkout-amanita/codigo/checkout/sections.tsx). The mockup shares one
 * accordion between its global FAQs drawer and the per-section questions
 * ("Preguntas sobre el acampe" under the Alojamiento cards), so this lives on
 * its own rather than inside either consumer: `FaqsDrawer` and
 * `AmanitaStepFaqs` are the same list in two places.
 *
 * `q`/`a` are renamed `question`/`answer` to match this repo's
 * `template_config` shape.
 */
import { useState } from "react"
import { GoldStar } from "./GoldStar"

export interface FaqItem {
  question: string
  answer: string
}

export default function FaqList({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <div className="flex flex-col gap-3">
      {items.map((faq, i) => {
        const isOpen = open === i
        return (
          <div
            key={`${faq.question}-${i}`}
            className="rounded-2xl border border-white/10"
            style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
            >
              <span className="flex items-center gap-3">
                <GoldStar className="h-3 w-3" />
                <span className="text-sm font-semibold text-cream md:text-base">
                  {faq.question}
                </span>
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className={`h-4 w-4 shrink-0 text-sand transition-transform ${isOpen ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {isOpen && (
              <p
                className="px-5 pb-5 pl-[3.15rem] text-left text-sm leading-relaxed"
                style={{ color: "rgba(241,235,227,0.75)" }}
              >
                {faq.answer}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
