"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import type { ReactNode } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { readAndClearPendingPaymentRedirectState } from "@/hooks/usePaymentRedirect"
import { useCheckout } from "@/providers/checkoutProvider"
import CheckoutToast from "./CheckoutToast"
import DynamicProductStep from "./DynamicProductStep"
import { shouldUseDynamicStep } from "./registries/stepRegistry"
import type { WatermarkStyle } from "./ScrollySectionNav"
import ScrollySectionNav from "./ScrollySectionNav"
import SectionHeader from "./SectionHeader"
import SnapDotNav from "./SnapDotNav"
import SnapFooter from "./SnapFooter"
import SnapSection from "./SnapSection"
import ConfirmStep from "./steps/ConfirmStep"
import OpenCheckoutBuyerStep from "./steps/OpenCheckoutBuyerStep"
import PassSelectionSection from "./steps/PassSelectionSection"

interface ScrollyCheckoutFlowProps {
  onPaymentComplete?: () => void
  onBack?: () => void
  navExtraContent?: ReactNode
  /** Tenant logo shown on the left side of the checkout nav. Usually
   *  `popup.icon_url` with a tenant fallback. */
  brandLogoUrl?: string | null
  /** Tenant/popup name for alt text on the logo. */
  brandLabel?: string
}

function ScrollyCheckoutFlowInner({
  onPaymentComplete,
  onBack,
  navExtraContent,
  brandLogoUrl,
  brandLabel,
}: ScrollyCheckoutFlowProps) {
  const {
    availableSteps,
    submitPayment,
    stepConfigs,
    isInitialLoading,
    markStepVisited,
  } = useCheckout()

  const searchParams = useSearchParams()
  const params = useParams<{ popupSlug: string }>()
  const router = useRouter()

  const isSimpleFIReturn = searchParams.get("checkout") === "success"

  useEffect(() => {
    if (!isSimpleFIReturn) return
    // Discard any persisted redirect state from a prior session so it does
    // not leak into the next purchase.
    readAndClearPendingPaymentRedirectState()
    router.replace(`/portal/${params.popupSlug}/passes`)
  }, [isSimpleFIReturn, params.popupSlug, router])

  const handlePayment = async () => {
    const result = await submitPayment()
    if (result.success) {
      onPaymentComplete?.()
    }
  }

  // Initial activeSection: first available step from the runtime,
  // falling back to "passes" only when nothing has loaded yet. Hardcoding
  // "passes" caused the cart footer to misdetect the first step when the
  // popup placed buyer or a hero step at order 0.
  const [activeSection, setActiveSection] = useState<string>(
    availableSteps[0] ?? "passes",
  )
  const scrollToIndexRef = useRef<((index: number) => void) | null>(null)

  const footerDesign = "pill" as const
  const watermarkStyle: WatermarkStyle = "bold"

  const allSections = useMemo(() => {
    // Walk availableSteps in funnel order and consume one matching config per
    // step. With duplicates (e.g. two housing rows) each section gets its OWN
    // config and a disambiguated id — `housing-2` for the second occurrence —
    // so React keys stay unique and the variant doesn't bleed across steps.
    const counts: Record<string, number> = {}
    const consumedConfigIds = new Set<string>()

    const defaultLabels: Record<string, string> = {
      passes: "Select Your Passes",
      tickets: "Select Your Passes",
      housing: "Choose Housing",
      merch: "Event Merchandise",
      patron: "Become a Patron",
      confirm: "Review & Confirm",
    }

    return availableSteps
      .filter((s) => s !== "success")
      .map((step) => {
        counts[step] = (counts[step] ?? 0) + 1
        const sectionId = counts[step] === 1 ? step : `${step}-${counts[step]}`

        const config = stepConfigs.find(
          (c) =>
            !consumedConfigIds.has(c.id) &&
            (c.step_type === step ||
              (c.step_type === "tickets" && step === "passes")),
        )
        if (config) consumedConfigIds.add(config.id)

        return {
          id: sectionId,
          stepType: step,
          config: config ?? null,
          label: config?.title ?? defaultLabels[step] ?? step,
          template: config?.template ?? null,
          emoji: config?.emoji ?? null,
          showInNavbar: config?.show_in_navbar ?? true,
        }
      })
  }, [availableSteps, stepConfigs])

  // Sections rendered in the top nav chrome. Subset of allSections — the
  // IntersectionObserver still tracks the full set so scroll behaviour
  // is unchanged, but informational steps (FAQs, Gallery, etc.) can be
  // hidden from the nav per-tenant via `show_in_navbar`.
  const navSections = useMemo(
    () => allSections.filter((s) => s.showInNavbar !== false),
    [allSections],
  )

  const goToConfirm = useCallback(() => {
    const idx = allSections.findIndex((s) => s.id === "confirm")
    scrollToIndexRef.current?.(idx)
  }, [allSections])

  const goToNextSection = useCallback(() => {
    const idx = allSections.findIndex((s) => s.id === activeSection)
    if (idx >= 0 && idx < allSections.length - 1) {
      scrollToIndexRef.current?.(idx + 1)
    }
  }, [allSections, activeSection])

  const goToPreviousSection = useCallback(() => {
    const idx = allSections.findIndex((s) => s.id === activeSection)
    if (idx > 0) {
      scrollToIndexRef.current?.(idx - 1)
    }
  }, [allSections, activeSection])

  // Public escape-hatch: jump to a specific step by id. Used by the
  // validation flow when Continuar/Pagar bounces the user back to a
  // failing step (toast → click chip → scrolls to buyer step).
  const scrollToStep = useCallback(
    (stepId: string) => {
      const idx = allSections.findIndex((s) => s.id === stepId)
      if (idx >= 0) scrollToIndexRef.current?.(idx)
    },
    [allSections],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: isInitialLoading must trigger a re-run when sections mount in the DOM, even though it's not read inside.
  useEffect(() => {
    const findScrollContainer = (): HTMLElement | null => {
      const anchor = document.getElementById(allSections[0]?.id ?? "passes")
      if (!anchor) return null
      let node: HTMLElement | null = anchor.parentElement
      while (node && node !== document.documentElement) {
        const { overflowY, overflow } = getComputedStyle(node)
        if (/(auto|scroll)/.test(overflowY) || /(auto|scroll)/.test(overflow)) {
          return node
        }
        node = node.parentElement
      }
      return null
    }

    const mainEl = findScrollContainer()
    if (!mainEl) return

    const updateHeight = () => {
      mainEl.style.setProperty("--snap-section-h", `${mainEl.clientHeight}px`)
      mainEl.style.setProperty(
        "--snap-scrollbar-w",
        `${mainEl.offsetWidth - mainEl.clientWidth}px`,
      )
    }
    updateHeight()
    const ro = new ResizeObserver(updateHeight)
    ro.observe(mainEl)

    const navEl = mainEl.querySelector<HTMLElement>("[data-snap-nav]")
    const updateNavHeight = () => {
      const h = navEl?.getBoundingClientRect().height ?? 48
      mainEl.style.setProperty("--snap-nav-h", `${h}px`)
    }
    updateNavHeight()
    const navRo = new ResizeObserver(updateNavHeight)
    if (navEl) navRo.observe(navEl)

    const sectionsSnapshot = allSections

    const prevSnapType = mainEl.style.scrollSnapType
    // `proximity` (not `mandatory`): sections here can be 2-3 viewport
    // heights tall (ticket/housing card lists). Mandatory snap turns the
    // gaps between snap points into dead zones — a moderate touch flick
    // that ends mid-gap gets yanked back to the previous section, which
    // on phones feels like the page refusing to scroll. Proximity keeps
    // the aligned-landing behaviour near section tops and frees the rest.
    mainEl.style.scrollSnapType = "y proximity"

    const sectionEls = sectionsSnapshot
      .map((s) => document.getElementById(s.id))
      .filter(Boolean) as HTMLElement[]
    for (const el of sectionEls) {
      el.style.scrollSnapAlign = "start"
      // Why: `scroll-snap-stop: always` makes Chrome/Safari refuse to leave
      // the current snap point on programmatic scrollTo / scrollIntoView,
      // so clicking the footer or nav while already snapped to a section
      // does nothing visually. Mandatory snap alone still snaps to the
      // nearest section at the end of any user-driven scroll.
      el.style.scrollSnapStop = "normal"
    }

    // Which section currently crosses the "active band" — a horizontal
    // strip 35-45% down the scrollport. Geometry fallback for the band
    // observer below; both must agree on the same band.
    const sectionAtBand = (): string | null => {
      const rootRect = mainEl.getBoundingClientRect()
      const bandY = rootRect.top + rootRect.height * 0.4
      for (const el of sectionEls) {
        const r = el.getBoundingClientRect()
        if (r.top <= bandY && r.bottom > bandY) return el.id
      }
      return null
    }

    // While a programmatic scroll is in flight we lock the active section to
    // the destination so the IntersectionObserver doesn't flip through every
    // intermediate section as they pass under the viewport.
    let scrollTargetId: string | null = null
    let scrollTargetTimeout: number | null = null
    const releaseScrollTarget = (settle = false) => {
      scrollTargetId = null
      if (scrollTargetTimeout !== null) {
        window.clearTimeout(scrollTargetTimeout)
        scrollTargetTimeout = null
      }
      // Safety-net path (lock expired without the target reporting in,
      // e.g. the smooth scroll was interrupted by a touch): settle the
      // highlight from actual geometry instead of leaving it wherever
      // the optimistic set put it.
      if (settle) {
        const id = sectionAtBand()
        if (id) {
          markStepVisited(id)
          setActiveSection(id)
        }
      }
    }

    // Self-owned smooth scroll (rAF) instead of el.scrollIntoView({smooth}).
    // Native smooth scroll serialises one animation at a time, so rapid nav
    // taps misbehave: Chrome queues them (the page lags far behind the taps)
    // and iOS Safari drops the overlapping calls outright (the page stops
    // moving until a manual scroll clears the stuck animation — the exact
    // "tap stops working, nudge unsticks it" report). A loop we own retargets
    // instantly on every tap and always settles on the latest destination.
    let scrollRafId: number | null = null
    const cancelScrollAnim = () => {
      if (scrollRafId !== null) {
        window.cancelAnimationFrame(scrollRafId)
        scrollRafId = null
      }
    }
    const animateScrollTo = (top: number, onDone: () => void) => {
      cancelScrollAnim()
      const maxTop = mainEl.scrollHeight - mainEl.clientHeight
      const dest = Math.max(0, Math.min(top, maxTop))
      const start = mainEl.scrollTop
      const dist = dest - start
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches
      if (reduceMotion || Math.abs(dist) < 1) {
        mainEl.scrollTop = dest
        onDone()
        return
      }
      // Duration scales with distance but is clamped so even a full-page
      // jump stays snappy (≤600ms).
      const duration = Math.min(600, Math.max(240, Math.abs(dist) * 0.4))
      const startTime = performance.now()
      const easeOutCubic = (p: number) => 1 - (1 - p) ** 3
      const step = (now: number) => {
        const p = Math.min(1, (now - startTime) / duration)
        mainEl.scrollTop = start + dist * easeOutCubic(p)
        if (p < 1) {
          scrollRafId = window.requestAnimationFrame(step)
        } else {
          scrollRafId = null
          onDone()
        }
      }
      scrollRafId = window.requestAnimationFrame(step)
    }

    // A real touch/wheel scroll must always win over an in-flight
    // programmatic animation: abort it and hand control back to the band
    // observer so the highlight tracks the user's finger.
    const onUserScrollIntent = () => {
      if (scrollRafId !== null) {
        cancelScrollAnim()
        releaseScrollTarget()
      }
    }
    mainEl.addEventListener("touchstart", onUserScrollIntent, { passive: true })
    mainEl.addEventListener("wheel", onUserScrollIntent, { passive: true })

    // Active = the section overlapping the band, NOT "≥30% of the section
    // visible". The old ratio threshold was unreachable for tall sections
    // on real phones: a 2,100px ticket list in a ~550px visual viewport
    // (browser chrome showing) peaks at ratio ~0.27, so the nav highlight
    // froze on whatever step last fired. Band intersection is independent
    // of section height, and guarantees the in-flight lock below is always
    // released by an arrival event.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id
            // Crossing the band counts as "visited" for the wayfinding
            // nav. Triggered for both natural and programmatic scroll,
            // so the user gets credited for visits they actively chose.
            markStepVisited(id)
            if (scrollTargetId !== null) {
              if (id === scrollTargetId) {
                releaseScrollTarget()
                setActiveSection(id)
              }
              continue
            }
            setActiveSection(id)
          }
        }
      },
      { root: mainEl, rootMargin: "-35% 0px -55% 0px", threshold: 0 },
    )
    for (const el of sectionEls) observer.observe(el)

    scrollToIndexRef.current = (index: number) => {
      const clamped = Math.max(0, Math.min(index, sectionsSnapshot.length - 1))
      const targetId = sectionsSnapshot[clamped].id
      const el = document.getElementById(targetId)
      if (!el) return
      // Lock the highlight to the destination so the band observer doesn't
      // flip through intermediate sections while we animate there.
      scrollTargetId = targetId
      if (scrollTargetTimeout !== null) {
        window.clearTimeout(scrollTargetTimeout)
      }
      // Backstop: if the animation callback is somehow missed, release the
      // lock and settle the highlight from geometry.
      scrollTargetTimeout = window.setTimeout(
        () => releaseScrollTarget(true),
        1500,
      )
      setActiveSection(targetId)
      // scrollTop that puts the section top at the scrollport top — same
      // landing as scrollIntoView({block:"start"}) given snap-align:start.
      const targetTop =
        el.getBoundingClientRect().top -
        mainEl.getBoundingClientRect().top +
        mainEl.scrollTop
      animateScrollTo(targetTop, () => {
        // Only settle if this tap is still the active intent — a later tap
        // (which reset scrollTargetId) or a user scroll must not be undone.
        if (scrollTargetId === targetId) {
          markStepVisited(targetId)
          setActiveSection(targetId)
          releaseScrollTarget()
        }
      })
    }

    return () => {
      mainEl.style.removeProperty("--snap-section-h")
      mainEl.style.removeProperty("--snap-nav-h")
      mainEl.style.removeProperty("--snap-scrollbar-w")
      mainEl.style.scrollSnapType = prevSnapType
      for (const el of sectionEls) {
        el.style.scrollSnapAlign = ""
        el.style.scrollSnapStop = ""
      }
      observer.disconnect()
      ro.disconnect()
      navRo.disconnect()
      cancelScrollAnim()
      mainEl.removeEventListener("touchstart", onUserScrollIntent)
      mainEl.removeEventListener("wheel", onUserScrollIntent)
      releaseScrollTarget()
      scrollToIndexRef.current = null
    }
  }, [allSections, isInitialLoading, markStepVisited])

  const renderSectionContent = (section: (typeof allSections)[number]) => {
    const { stepType, config } = section

    if (stepType === "buyer") return <OpenCheckoutBuyerStep />
    if (stepType === "confirm") return <ConfirmStep />

    if (stepType === "passes" || stepType === "tickets") {
      if (shouldUseDynamicStep(config ?? undefined)) {
        return <DynamicProductStep stepConfig={config!} onSkip={() => {}} />
      }
      return <PassSelectionSection />
    }

    if (config) {
      return <DynamicProductStep stepConfig={config} onSkip={() => {}} />
    }

    return null
  }

  if (isSimpleFIReturn) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-current opacity-60" />
      </div>
    )
  }

  if (isInitialLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-current opacity-60" />
      </div>
    )
  }

  const lastSectionId = allSections[allSections.length - 1]?.id

  return (
    <div className="relative font-sans">
      <ScrollySectionNav
        sections={navSections}
        activeSection={activeSection}
        onSectionClick={(sectionId) => {
          const idx = allSections.findIndex((s) => s.id === sectionId)
          if (idx >= 0) scrollToIndexRef.current?.(idx)
        }}
        extraContent={navExtraContent}
        brandLogoUrl={brandLogoUrl}
        brandLabel={brandLabel}
      />
      <CheckoutToast onChipClick={scrollToStep} />
      {allSections.map((section) => {
        const { config } = section
        // The ticket-card "stacked" layout renders a responsive grid of cards,
        // which needs more width than the default centred column. Other steps
        // (and the tabs/compact ticket-card variants) keep the narrow column.
        const templateConfig = config?.template_config as
          | Record<string, unknown>
          | undefined
        const isStackedCards =
          config?.template === "ticket-card" &&
          (templateConfig?.variant ?? "stacked") === "stacked"
        return (
          <SnapSection
            key={section.id}
            id={section.id}
            bottomPadding={section.id === lastSectionId ? "4rem" : "50vh"}
            widthClass={isStackedCards ? "max-w-6xl" : "max-w-2xl"}
          >
            {/* Header and footer stay in the narrow column even when the step
                is widened for a card grid, so the section title/watermark keep
                the same size and rhythm as every other step. Only the step
                content (the grid) uses the wider width. The max-w-2xl wrapper
                is a no-op on non-widened steps. */}
            <div className="mx-auto w-full max-w-2xl">
              <SectionHeader
                title={config?.title ?? section.label}
                subtitle={config?.description ?? undefined}
                variant="snap"
                watermark={config?.watermark ?? section.label}
                watermarkStyle={watermarkStyle}
                showTitle={config?.show_title ?? true}
                showWatermark={config?.show_watermark ?? true}
              />
            </div>
            {renderSectionContent(section)}
            {(() => {
              const ft = (
                config?.template_config as Record<string, unknown> | undefined
              )?.footer_text
              return typeof ft === "string" && ft ? (
                <div className="mx-auto w-full max-w-2xl">
                  <p className="text-xs text-gray-400 leading-relaxed px-1 pt-4 text-center">
                    {ft}
                  </p>
                </div>
              ) : null
            })()}
          </SnapSection>
        )
      })}

      <SnapDotNav
        sections={allSections}
        activeSection={activeSection}
        onDotClick={(i) => scrollToIndexRef.current?.(i)}
      />

      <SnapFooter
        footerDesign={footerDesign}
        onPay={handlePayment}
        onBack={onBack}
        activeSection={activeSection}
        sections={allSections}
        onGoToConfirm={goToConfirm}
        onGoToNextSection={goToNextSection}
        onGoToPreviousSection={goToPreviousSection}
        onScrollToStep={scrollToStep}
      />
    </div>
  )
}

export default function ScrollyCheckoutFlow(props: ScrollyCheckoutFlowProps) {
  return <ScrollyCheckoutFlowInner {...props} />
}

export type { ScrollyCheckoutFlowProps }
