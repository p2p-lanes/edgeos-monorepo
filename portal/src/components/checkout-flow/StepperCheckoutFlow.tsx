"use client"

import Image from "next/image"
import { useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader } from "@/components/ui/Loader"
import { imageOptimization } from "@/lib/image-optimization"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { formatCurrency } from "@/types/checkout"
import CheckoutToast from "./CheckoutToast"
import DynamicProductStep from "./DynamicProductStep"
import { deriveCheckoutSections } from "./deriveCheckoutSections"
import { shouldUseDynamicStep } from "./registries/stepRegistry"
import type { ScrollyCheckoutFlowProps } from "./ScrollyCheckoutFlow"
import SectionHeader from "./SectionHeader"
import ConfirmStep from "./steps/ConfirmStep"
import OpenCheckoutBuyerStep from "./steps/OpenCheckoutBuyerStep"
import PassSelectionSection from "./steps/PassSelectionSection"

export default function StepperCheckoutFlow({
  onPaymentComplete,
  navExtraContent,
  brandLogoUrl,
  brandLabel,
}: ScrollyCheckoutFlowProps) {
  const { t } = useTranslation()
  const {
    availableSteps,
    stepConfigs,
    submitPayment,
    isInitialLoading,
    markStepVisited,
    cart,
    summary,
    isSubmitting,
    termsAccepted,
  } = useCheckout()
  const { getCity } = useCityProvider()
  const popup = getCity()

  const sections = useMemo(
    () => deriveCheckoutSections(availableSteps as string[], stepConfigs),
    [availableSteps, stepConfigs],
  )
  const navSections = useMemo(
    () => sections.filter((s) => s.showInNavbar !== false),
    [sections],
  )

  const [active, setActive] = useState(0)
  const last = Math.max(0, sections.length - 1)

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), last)
      const id = sections[clamped]?.id
      if (id) markStepVisited(id)
      setActive(clamped)
    },
    [last, sections, markStepVisited],
  )

  const scrollToStep = useCallback(
    (stepId: string) => {
      const idx = sections.findIndex((s) => s.id === stepId)
      if (idx >= 0) goTo(idx)
    },
    [sections, goTo],
  )

  const handlePayment = useCallback(async () => {
    const result = await submitPayment()
    if (result.success) onPaymentComplete?.()
  }, [submitPayment, onPaymentComplete])

  if (isInitialLoading) return <Loader />

  const current = sections[active]
  const isLast = active === last
  const nextSection = !isLast ? sections[active + 1] : undefined
  const itemCount =
    cart.passes.length +
    (cart.housing ? 1 : 0) +
    cart.merch.length +
    (cart.patron ? 1 : 0)
  const requiresTerms = !!popup?.terms_and_conditions_url && !termsAccepted
  const canPay = cart.passes.length > 0 && !requiresTerms && !isSubmitting

  const renderStepContent = (section: (typeof sections)[number]) => {
    const { stepType, config } = section
    const isFirstSection = active === 0
    if (stepType === "buyer") return <OpenCheckoutBuyerStep />
    if (stepType === "confirm") return <ConfirmStep />
    if (stepType === "passes" || stepType === "tickets") {
      if (shouldUseDynamicStep(config ?? undefined)) {
        return (
          <DynamicProductStep
            stepConfig={config!}
            onSkip={() => {}}
            isFirstSection={isFirstSection}
          />
        )
      }
      return <PassSelectionSection />
    }
    if (config) {
      return (
        <DynamicProductStep
          stepConfig={config}
          onSkip={() => {}}
          isFirstSection={isFirstSection}
        />
      )
    }
    return null
  }

  return (
    <div className="relative min-h-svh font-sans">
      {/* pills nav */}
      <nav
        aria-label="Checkout sections"
        className="sticky top-0 z-40 flex gap-2 overflow-x-auto bg-background/90 px-4 py-3 backdrop-blur"
      >
        {navSections.map((section) => {
          const idx = sections.findIndex((s) => s.id === section.id)
          const isActive = idx === active
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => goTo(idx)}
              aria-current={isActive ? "step" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {section.label}
            </button>
          )
        })}
        {navExtraContent}
      </nav>

      <CheckoutToast onChipClick={scrollToStep} />

      {/* one section at a time */}
      <main className="mx-auto w-full max-w-2xl px-4 pb-40 pt-6">
        {brandLogoUrl && (
          <Image
            src={brandLogoUrl}
            alt={brandLabel ?? ""}
            width={40}
            height={40}
            className="mx-auto mb-4 h-10 w-auto"
            {...imageOptimization(brandLogoUrl)}
          />
        )}
        {current && (
          <>
            <div className="mb-8">
              <SectionHeader
                title={current.config?.title ?? current.label}
                subtitle={current.config?.description ?? undefined}
                variant="snap"
                watermark={current.config?.watermark ?? current.label}
                showTitle={current.config?.show_title ?? true}
                showWatermark={current.config?.show_watermark ?? true}
              />
            </div>
            {renderStepContent(current)}
          </>
        )}
      </main>

      {/* fixed bottom bar: Back / Total / contextual CTA */}
      <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-2xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => goTo(active - 1)}
            disabled={active === 0}
            className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {t("common.back")}
          </button>
          <div className="flex min-w-0 flex-col items-center">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total
            </span>
            <span className="text-lg font-bold text-foreground">
              {formatCurrency(summary.grandTotal)}
            </span>
          </div>
          {isLast ? (
            <button
              type="button"
              data-testid="stepper-next"
              onClick={handlePayment}
              disabled={!canPay}
              className="shrink-0 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {summary.grandTotal === 0
                ? t("checkout.actions.claim_pass")
                : t("checkout.actions.pay")}
            </button>
          ) : (
            <button
              type="button"
              data-testid="stepper-next"
              onClick={() => goTo(active + 1)}
              className="shrink-0 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              {nextSection?.label}
            </button>
          )}
          {itemCount > 0 && (
            <span className="sr-only">{itemCount} items in cart</span>
          )}
        </div>
      </div>
    </div>
  )
}
