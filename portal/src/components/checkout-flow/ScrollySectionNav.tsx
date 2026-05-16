"use client"

import { Check } from "lucide-react"
import type { ReactNode } from "react"
import { getRegistryIcon, resolveStepIcon } from "@/lib/checkoutStepIcons"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import type { CheckoutStep } from "@/types/checkout"

export type FooterDesign = "pill" | "stripe" | "dock"
export type WatermarkStyle = "none" | "ghost" | "stroke" | "bold"

// Icon resolution lives in `@/lib/checkoutStepIcons` so the cart drawer
// (and other surfaces) can render the same registry without duplicating
// the step-type / template lookup tables.
const resolveIcon = (section: { id: string; template?: string | null }) =>
  resolveStepIcon({ stepType: section.id, template: section.template })

interface NavSection {
  id: string
  label: string
  template?: string | null
  /** Tenant-picked emoji, either as a registry slug (e.g. "user", "mushroom")
   *  or a literal emoji character. Registry slugs win; literal emoji
   *  characters render as a text node with optional monochrome filter. */
  emoji?: string | null
}

interface ScrollySectionNavProps {
  sections: NavSection[]
  activeSection: string
  onSectionClick: (sectionId: string) => void
  extraContent?: ReactNode
  /** Tenant logo (popup icon_url with tenant fallback) shown on the left
   *  of the nav. Skipped when null. */
  brandLogoUrl?: string | null
  /** Display name used as alt text on the logo. */
  brandLabel?: string
}

export default function ScrollySectionNav({
  sections,
  activeSection,
  onSectionClick,
  extraContent,
  brandLogoUrl,
  brandLabel,
}: ScrollySectionNavProps) {
  const {
    isStepComplete,
    visitedSteps,
    isBuyerInfoComplete,
    forcedBuyerFieldsTouched,
  } = useCheckout()

  // Predicate: is this step required-but-incomplete for the user right
  // now? Only the buyer step has formal field validation today, but the
  // helper is shaped so additional gated steps can join later (e.g. a
  // future "require at least one ticket" rule).
  //
  // A step is shown as "incomplete" in the nav when:
  //   * the user has scrolled past it (visited), OR
  //   * the funnel forcefully revealed errors after a Continuar/Pagar
  //     attempt (forcedBuyerFieldsTouched > 0).
  // Untouched required steps are NOT flagged — anxiety-inducing to
  // shout at users about fields they haven't seen.
  const isStepIncomplete = (stepId: string): boolean => {
    if (stepId === "buyer") {
      if (isBuyerInfoComplete) return false
      const surfacedByForce = forcedBuyerFieldsTouched.size > 0
      return surfacedByForce || visitedSteps.has(stepId)
    }
    return false
  }

  const activeIndex = Math.max(
    0,
    sections.findIndex((s) => s.id === activeSection),
  )
  const segmentWidthPct = sections.length > 0 ? 100 / sections.length : 100

  return (
    <div data-snap-nav className="sticky top-0 z-20">
      <div className="bg-checkout-navbar-bg/85 px-2.5 py-1.5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center gap-1.5">
          {brandLogoUrl ? (
            // Small tenant logo, sized 28px. Next/image not used because
            // tenant icon URLs come from arbitrary CDNs and don't need
            // SSR-time optimisation at this scale.
            // biome-ignore lint/performance/noImgElement: tenant logo, sized small, no need for next/image SSR
            <img
              src={brandLogoUrl}
              alt={brandLabel ?? "Tenant logo"}
              className="size-7 shrink-0 rounded-md object-contain"
            />
          ) : null}
          <div className="relative flex-1 overflow-hidden rounded-xl border border-white/10 bg-checkout-badge-bg-disabled/60 p-0.5">
            <div
              aria-hidden
              className="absolute inset-y-0.5 rounded-lg bg-checkout-badge-bg shadow-sm transition-[transform,width] duration-300 ease-out"
              style={{
                width: `calc(${segmentWidthPct}% - 0.125rem)`,
                transform: `translateX(calc(${activeIndex * 100}% + ${activeIndex * 0.125}rem))`,
                left: "0.125rem",
              }}
            />
            <div className="relative grid auto-cols-fr grid-flow-col">
              {sections.map((section) => {
                const Icon = resolveIcon(section)
                const isActive = section.id === activeSection
                const isComplete =
                  !isActive && isStepComplete(section.id as CheckoutStep)
                const isIncomplete = !isActive && isStepIncomplete(section.id)
                const emoji = section.emoji?.trim()
                // Two ways a tenant can specify the nav icon: a slug into
                // the curated Lucide registry ("user", "mushroom", …)
                // which renders a stroke SVG, OR a literal emoji
                // character. If neither is set, the step-type/template
                // default applies via resolveIcon. The literal-emoji
                // branch picks up the optional monochrome filter so
                // colorful glyphs can be forced to a single tone.
                const RegistryIcon = getRegistryIcon(emoji)
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => onSectionClick(section.id)}
                    aria-current={isActive ? "step" : undefined}
                    aria-invalid={isIncomplete || undefined}
                    className={cn(
                      "relative z-10 flex h-7 min-w-0 items-center justify-center gap-1 px-1.5 text-xs font-semibold transition-[color,opacity] duration-200",
                      isActive
                        ? "text-checkout-badge-title"
                        : isIncomplete
                          ? // Muted amber tint — "needs your attention"
                            // without the red-alarm rage of a destructive
                            // colour. Matches the toast/banner palette.
                            "text-amber-400 hover:text-amber-300"
                          : "text-checkout-badge-title-disabled hover:opacity-70",
                    )}
                  >
                    {RegistryIcon ? (
                      <RegistryIcon className="size-3.5 shrink-0" />
                    ) : emoji ? (
                      <span
                        aria-hidden
                        style={{
                          filter:
                            "var(--checkout-nav-emoji-filter, none)" as string,
                        }}
                        className="text-sm leading-none shrink-0"
                      >
                        {emoji}
                      </span>
                    ) : (
                      <Icon className="size-3.5 shrink-0" />
                    )}
                    <span className="hidden truncate sm:inline">
                      {section.label}
                    </span>
                    {isComplete && (
                      <Check className="size-2.5 text-emerald-400" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          {extraContent ? <div className="shrink-0">{extraContent}</div> : null}
        </div>
      </div>
    </div>
  )
}
