"use client"

import { Check } from "lucide-react"
import Image from "next/image"
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { getRegistryIcon, resolveStepIcon } from "@/lib/checkoutStepIcons"
import { imageOptimization } from "@/lib/image-optimization"
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

// Measuring the active tab to place the sliding pill must happen before the
// browser paints (otherwise the pill lands a frame late on first render).
// useLayoutEffect does that on the client; fall back to useEffect on the
// server so SSR doesn't warn about a no-op layout effect.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect

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

  // Adaptive density. Two sizing strategies fight each other across the width
  // range: desktop wants content-width tabs (full labels, never truncated),
  // mobile wants equal-width tabs that shrink so every icon still fits. No
  // single CSS rule does both, so we measure: keep full labels while the row
  // fits the track, and collapse to equal-width icon-only tabs once it would
  // overflow. The result never truncates a label and never clips an icon at
  // any width or step count. `compact` drives both the layout and whether
  // labels render.
  // Stable full-width wrapper used as the available-width reference. The track
  // itself swaps between w-fit (expanded) and w-full (compact), so measuring it
  // would couple `avail` to `compact` — see the effect below.
  const shellRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  const [compact, setCompact] = useState(false)
  // Width the labelled row needs, captured while expanded. Used as the
  // hysteresis threshold so the boundary doesn't flap between modes.
  const expandedWidthRef = useRef(0)

  useIsomorphicLayoutEffect(() => {
    const recalc = () => {
      const list = listRef.current
      // Measure available width from the stable shell, never the track. The
      // track is w-fit while expanded and w-full while compact, so reading its
      // width would make `avail` depend on `compact`. Since this effect also
      // writes `compact` (and re-runs on it), that feedback flip-flops
      // true<->false forever until React aborts with "Maximum update depth
      // exceeded" (#185). The shell is always full-width, so the decision has a
      // fixed basis and settles within a 1px hysteresis band.
      const shell = shellRef.current
      if (list && shell) {
        const avail = shell.clientWidth
        if (!compact) {
          // Labels are showing → scrollWidth is the true expanded width.
          expandedWidthRef.current = list.scrollWidth
          if (list.scrollWidth > avail + 1) setCompact(true)
        } else if (
          expandedWidthRef.current > 0 &&
          expandedWidthRef.current <= avail
        ) {
          // Enough room came back for the labelled row to fit again.
          setCompact(false)
        }
      }
      const btn = buttonRefs.current[activeIndex]
      if (btn) setPill({ left: btn.offsetLeft, width: btn.offsetWidth })
    }

    recalc()

    // Safety net only: in compact mode everything fits, but on an extreme
    // viewport (even icons overflow) keep the active step in view.
    const btn = buttonRefs.current[activeIndex]
    const track = trackRef.current
    if (btn && track) {
      const target =
        btn.offsetLeft + btn.offsetWidth / 2 - track.clientWidth / 2
      track.scrollTo({ left: Math.max(0, target), behavior: "smooth" })
    }

    const shell = shellRef.current
    if (!shell) return
    const ro = new ResizeObserver(recalc)
    ro.observe(shell)
    return () => ro.disconnect()
    // sections.length re-runs when tabs change; compact re-runs after a mode
    // flip so the measurement settles (pre-paint, so no visible flicker).
  }, [activeIndex, sections.length, compact])

  return (
    <div data-snap-nav className="sticky top-0 z-20">
      <div className="bg-checkout-navbar-bg/85 px-2.5 py-1.5 backdrop-blur-xl">
        <div className="flex items-center gap-1.5">
          {brandLogoUrl ? (
            <Image
              src={brandLogoUrl}
              alt={brandLabel ?? "Tenant logo"}
              width={28}
              height={28}
              priority
              className="size-7 shrink-0 rounded-md object-contain"
              {...imageOptimization(brandLogoUrl)}
            />
          ) : null}
          <div
            ref={shellRef}
            className={cn("flex min-w-0 flex-1", !compact && "justify-center")}
          >
            <div
              ref={trackRef}
              className={cn(
                "relative overflow-x-auto rounded-xl border border-white/10 bg-checkout-badge-bg-disabled/60 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                // Expanded: the bar hugs the centred tab group, so the sides
                // show the page background instead of an empty track. Compact:
                // fill the row so equal-width icon tabs distribute.
                compact ? "w-full" : "w-fit max-w-full",
              )}
            >
              <div
                ref={listRef}
                className={cn(
                  "relative flex",
                  // Expanded: content-width tabs sit adjacent so the pill slides
                  // between them (segmented-control feel). Compact: equal-width.
                  compact ? "w-full" : "w-max",
                )}
              >
                {pill && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-0 rounded-lg bg-checkout-badge-bg shadow-sm transition-[transform,width] duration-300 ease-out"
                    style={{
                      width: `${pill.width}px`,
                      transform: `translateX(${pill.left}px)`,
                    }}
                  />
                )}
                {sections.map((section, index) => {
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
                      ref={(el) => {
                        buttonRefs.current[index] = el
                      }}
                      type="button"
                      onClick={() => onSectionClick(section.id)}
                      aria-current={isActive ? "step" : undefined}
                      aria-invalid={isIncomplete || undefined}
                      className={cn(
                        "relative z-10 flex h-7 items-center justify-center text-xs font-semibold transition-[color,opacity] duration-200",
                        // Compact equal-width icons vs. expanded content-width
                        // labelled tabs.
                        compact
                          ? "min-w-0 flex-1 gap-1 px-1"
                          : "shrink-0 gap-1.5 px-3",
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
                      {!compact && (
                        <span className="whitespace-nowrap">
                          {section.label}
                        </span>
                      )}
                      {isComplete && (
                        <Check className="size-2.5 text-emerald-400" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          {extraContent ? <div className="shrink-0">{extraContent}</div> : null}
        </div>
      </div>
    </div>
  )
}
