"use client"

import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DesignVariantProvider } from "@/context/designVariant"
import { usePaymentVerification } from "@/hooks/checkout"
import { useApplication } from "@/providers/applicationProvider"
import { useCheckout } from "@/providers/checkoutProvider"
import DesignVariantPanel from "./DesignVariantPanel"
import DynamicProductStep from "./DynamicProductStep"
import {
  STEP_COMPONENT_REGISTRY,
  shouldUseDynamicStep,
} from "./registries/stepRegistry"
import type {
  FooterDesign,
  NavDesign,
  WatermarkStyle,
} from "./ScrollySectionNav"
import ScrollySectionNav from "./ScrollySectionNav"
import SectionHeader from "./SectionHeader"
import SnapDotNav from "./SnapDotNav"
import SnapFooter from "./SnapFooter"
import SnapSection from "./SnapSection"
import PassSelectionSection from "./steps/PassSelectionSection"
import SuccessStep from "./steps/SuccessStep"

interface ScrollyCheckoutFlowProps {
  onPaymentComplete?: () => void
  onBack?: () => void
}

const FOOTER_DESIGN_STORAGE_KEY = "passes-footer-design"
const NAV_DESIGN_STORAGE_KEY = "passes-nav-design"

function ScrollyCheckoutFlowInner({
  onPaymentComplete,
  onBack,
}: ScrollyCheckoutFlowProps) {
  const { availableSteps, submitPayment, stepConfigs } = useCheckout()

  const getStepConfig = (stepType: string) =>
    stepConfigs.find(
      (s) =>
        s.step_type === stepType ||
        (s.step_type === "tickets" && stepType === "passes"),
    )

  const searchParams = useSearchParams()
  const { getRelevantApplication } = useApplication()
  const application = getRelevantApplication()

  const isSimpleFIReturn = useMemo(
    () => searchParams.has("checkout", "success"),
    [searchParams],
  )

  const { paymentStatus } = usePaymentVerification({
    applicationId: application?.id,
    enabled: isSimpleFIReturn,
  })

  const handlePayment = async () => {
    const result = await submitPayment()
    if (result.success) {
      onPaymentComplete?.()
    }
  }

  const [activeSection, setActiveSection] = useState<string>("passes")
  const scrollToIndexRef = useRef<((index: number) => void) | null>(null)

  const [footerDesign, setFooterDesign] = useState<FooterDesign>("stripe")
  const [navDesign, setNavDesign] = useState<NavDesign>("pills")
  const watermarkStyle: WatermarkStyle = "bold"

  useEffect(() => {
    const storedDesign = localStorage.getItem(
      FOOTER_DESIGN_STORAGE_KEY,
    ) as FooterDesign | null
    if (
      storedDesign === "pill" ||
      storedDesign === "stripe" ||
      storedDesign === "dock"
    ) {
      setFooterDesign(storedDesign)
    }
    const storedNavDesign = localStorage.getItem(
      NAV_DESIGN_STORAGE_KEY,
    ) as NavDesign | null
    if (
      storedNavDesign === "pills" ||
      storedNavDesign === "progress" ||
      storedNavDesign === "underline"
    ) {
      setNavDesign(storedNavDesign)
    }
  }, [])

  const setFooterDesignPersisted = (v: FooterDesign) => {
    setFooterDesign(v)
    localStorage.setItem(FOOTER_DESIGN_STORAGE_KEY, v)
  }

  const setNavDesignPersisted = (v: NavDesign) => {
    setNavDesign(v)
    localStorage.setItem(NAV_DESIGN_STORAGE_KEY, v)
  }

  const allSections = useMemo(() => {
    return availableSteps
      .filter((s) => s !== "success")
      .map((step) => {
        const config = stepConfigs.find(
          (c) =>
            c.step_type === step ||
            (c.step_type === "tickets" && step === "passes"),
        )
        const defaultLabels: Record<string, string> = {
          passes: "Select Your Passes",
          tickets: "Select Your Passes",
          housing: "Choose Housing",
          merch: "Event Merchandise",
          patron: "Become a Patron",
          confirm: "Review & Confirm",
        }
        return {
          id: step,
          label: config?.title ?? defaultLabels[step] ?? step,
          template: config?.template ?? null,
        }
      })
  }, [availableSteps, stepConfigs])

  const goToConfirm = useCallback(() => {
    const idx = allSections.findIndex((s) => s.id === "confirm")
    scrollToIndexRef.current?.(idx)
  }, [allSections])

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

    const getScrollTop = (el: HTMLElement): number =>
      mainEl.scrollTop +
      el.getBoundingClientRect().top -
      mainEl.getBoundingClientRect().top

    const prevSnapType = mainEl.style.scrollSnapType
    mainEl.style.scrollSnapType = "y proximity"

    const sectionEls = sectionsSnapshot
      .map((s) => document.getElementById(s.id))
      .filter(Boolean) as HTMLElement[]
    for (const el of sectionEls) {
      el.style.scrollSnapAlign = "start"
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { root: mainEl, threshold: [0.3] },
    )
    for (const el of sectionEls) observer.observe(el)

    scrollToIndexRef.current = (index: number) => {
      const clamped = Math.max(0, Math.min(index, sectionsSnapshot.length - 1))
      const el = document.getElementById(sectionsSnapshot[clamped].id)
      if (!el) return
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches
      mainEl.scrollTo({
        top: getScrollTop(el),
        behavior: reduceMotion ? "auto" : "smooth",
      })
      setActiveSection(sectionsSnapshot[clamped].id)
    }

    return () => {
      mainEl.style.removeProperty("--snap-section-h")
      mainEl.style.removeProperty("--snap-nav-h")
      mainEl.style.removeProperty("--snap-scrollbar-w")
      mainEl.style.scrollSnapType = prevSnapType
      for (const el of sectionEls) {
        el.style.scrollSnapAlign = ""
      }
      observer.disconnect()
      ro.disconnect()
      navRo.disconnect()
      scrollToIndexRef.current = null
    }
  }, [allSections])

  const renderSectionContent = (stepId: string) => {
    if (stepId === "passes" || stepId === "tickets") {
      const ticketConfig = getStepConfig("tickets") ?? getStepConfig("passes")
      if (shouldUseDynamicStep(ticketConfig)) {
        return (
          <DynamicProductStep stepConfig={ticketConfig!} onSkip={() => {}} />
        )
      }
      return <PassSelectionSection />
    }

    const config = getStepConfig(stepId)

    if (shouldUseDynamicStep(config)) {
      return <DynamicProductStep stepConfig={config!} onSkip={() => {}} />
    }

    const FallbackComponent = STEP_COMPONENT_REGISTRY[stepId]
    if (FallbackComponent) {
      return <FallbackComponent onSkip={() => {}} />
    }

    if (config) {
      return <DynamicProductStep stepConfig={config} onSkip={() => {}} />
    }

    return null
  }

  if (isSimpleFIReturn) {
    return (
      <div className="min-h-screen">
        <SuccessStep paymentStatus={paymentStatus} />
      </div>
    )
  }

  const lastSectionId = allSections[allSections.length - 1]?.id

  return (
    <div className="relative font-sans">
      <ScrollySectionNav
        sections={allSections}
        activeSection={activeSection}
        onSectionClick={(sectionId) => {
          const idx = allSections.findIndex((s) => s.id === sectionId)
          if (idx >= 0) scrollToIndexRef.current?.(idx)
        }}
        variant={navDesign}
      />
      {allSections.map((section) => {
        const config = getStepConfig(section.id)
        return (
          <SnapSection
            key={section.id}
            id={section.id}
            bottomPadding={section.id === lastSectionId ? "4rem" : "50vh"}
          >
            <SectionHeader
              title={config?.title ?? section.label}
              subtitle={config?.description ?? undefined}
              variant="snap"
              watermark={config?.watermark ?? section.label}
              watermarkStyle={watermarkStyle}
              showTitle={config?.show_title ?? true}
              showWatermark={config?.show_watermark ?? true}
            />
            {renderSectionContent(section.id)}
            {(() => {
              const ft = (
                config?.template_config as Record<string, unknown> | undefined
              )?.footer_text
              return typeof ft === "string" && ft ? (
                <p className="text-xs text-gray-400 leading-relaxed px-1 pt-4 text-center">
                  {ft}
                </p>
              ) : null
            })()}
          </SnapSection>
        )
      })}

      <DesignVariantPanel
        navDesign={navDesign}
        onNavDesignChange={setNavDesignPersisted}
        footerDesign={footerDesign}
        onFooterDesignChange={setFooterDesignPersisted}
      />
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
        onGoToConfirm={goToConfirm}
      />
    </div>
  )
}

export default function ScrollyCheckoutFlow(props: ScrollyCheckoutFlowProps) {
  return (
    <DesignVariantProvider>
      <ScrollyCheckoutFlowInner {...props} />
    </DesignVariantProvider>
  )
}
