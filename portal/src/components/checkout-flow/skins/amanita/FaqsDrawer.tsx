"use client"

/**
 * Amanita skin — global FAQs drawer (Task 10).
 *
 * Ported from checkout-amanita/codigo/checkout/sections.tsx (`FaqsDrawer` +
 * `FaqList`). In the mockup the drawer read a hardcoded `FAQS` constant; here
 * it's driven by the checkout's own `faqs`-template step data — the caller
 * (StepperCheckoutFlow) passes `items` sourced from that step's
 * `template_config.items`, `{question, answer}[]` (the same shape
 * VariantFaqs.tsx already parses for the default skin's inline rendering).
 *
 * A11y ported VERBATIM from the mockup: `role="dialog"` + `aria-modal`, a
 * focus trap that cycles Tab/Shift+Tab within the panel, Escape closes,
 * body-scroll lock while open, a 44×44 (h-11/w-11) close button, and focus
 * returns to whatever had focus before opening (the "FAQs" pill) on close.
 */
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { GoldStar } from "./GoldStar"

export interface FaqDrawerItem {
  question: string
  answer: string
}

/** Accordion shared by the drawer's FAQ list — 1:1 port of the mockup's
 *  `FaqList` (renamed `q`/`a` -> `question`/`answer` to match this repo's
 *  `template_config.items` shape). */
function FaqList({ items }: { items: FaqDrawerItem[] }) {
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

export default function FaqsDrawer({
  open,
  items,
  onClose,
}: {
  open: boolean
  items: FaqDrawerItem[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden" // body-lock
    closeRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab" || !panelRef.current) return
      // focus trap: Tab cycles only within the panel
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      )
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return
      const current = document.activeElement
      if (event.shiftKey) {
        if (current === first || !panelRef.current.contains(current)) {
          event.preventDefault()
          last.focus()
        }
      } else if (current === last || !panelRef.current.contains(current)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = prevOverflow
      previous?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60]">
      {/* backdrop: click closes — the accessible path is the close button */}
      <div
        aria-hidden
        onClick={onClose}
        className="ck-drawer-backdrop absolute inset-0"
        style={{
          backgroundColor: "rgba(1,15,22,0.65)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
        }}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ck-faqs-drawer-title"
        className="ck-drawer-panel absolute inset-0 overflow-y-auto border-white/10 md:inset-y-0 md:left-auto md:right-0 md:w-[480px] md:border-l"
        style={{
          backgroundColor: "rgba(2,19,29,0.97)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          boxShadow: "-18px 0 48px rgba(1,15,22,0.55)",
        }}
      >
        <div
          aria-hidden
          className="dark-stars pointer-events-none absolute inset-0"
        />
        <div
          className="relative z-[1] px-5 pt-5 md:px-8"
          style={{ paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="pt-1.5">
              <p className="font-condensed text-xs font-medium uppercase tracking-[0.22em] text-sand">
                {t("checkout.amanita.faqs_kicker")}
              </p>
              <h2
                id="ck-faqs-drawer-title"
                className="mt-1 font-display text-2xl uppercase leading-tight text-cream"
              >
                {t("checkout.amanita.faqs_title")}
              </h2>
            </div>
            {/* 44×44 close button (h-11/w-11) */}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label={t("checkout.amanita.faqs_close_aria")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 text-cream transition-colors hover:border-mint hover:text-mint"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <p
            className="mt-2 max-w-[42ch] text-sm leading-relaxed"
            style={{ color: "rgba(241,235,227,0.72)" }}
          >
            {t("checkout.amanita.faqs_intro")}
          </p>
          <div className="mt-6">
            <FaqList items={items} />
          </div>
        </div>
      </aside>
    </div>
  )
}
