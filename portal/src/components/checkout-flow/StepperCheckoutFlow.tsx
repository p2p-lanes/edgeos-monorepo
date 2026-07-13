"use client"

import Image from "next/image"
import type { CSSProperties } from "react"
import { useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader } from "@/components/ui/Loader"
import { type CheckoutSkin, resolveCheckoutSkin } from "@/lib/checkout-skin"
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
import { AmanitaBackground } from "./skins/amanita/AmanitaBackground"
import AmanitaBuyerStep from "./skins/amanita/AmanitaBuyerStep"
import AmanitaConfirmSection from "./skins/amanita/AmanitaConfirmSection"
import "./skins/amanita/amanita-skin.css"
import { amanitaFontVars } from "./skins/amanita/fonts"
import ConfirmStep from "./steps/ConfirmStep"
import OpenCheckoutBuyerStep from "./steps/OpenCheckoutBuyerStep"
import PassSelectionSection from "./steps/PassSelectionSection"

/* Chrome (wrapper/nav/bottom-bar) className+style pairs per skin, keyed by
 * `CheckoutSkin`. `default` is the exact Plan 2 unskinned chrome; `amanita`
 * is ported from the mockup's `<header>`/pills nav and fixed bottom bar in
 * checkout-amanita/codigo/checkout/CheckoutExperience.tsx. Kept as small
 * per-element maps (rather than one big object) so each JSX spot stays a
 * simple `X[skin]` lookup. */
const ROOT_CLASSES: Record<CheckoutSkin, string> = {
  default: "relative min-h-svh font-sans",
  amanita: `checkout-amanita ${amanitaFontVars} section-dark relative min-h-dvh`,
}

const NAV: Record<CheckoutSkin, { className: string; style?: CSSProperties }> =
  {
    default: {
      className:
        "sticky top-0 z-40 flex gap-2 overflow-x-auto bg-background/90 px-4 py-3 backdrop-blur",
    },
    amanita: {
      className:
        "no-scrollbar fixed inset-x-0 top-0 z-40 mx-auto flex max-w-[980px] items-center gap-1.5 overflow-x-auto px-3 py-3 md:justify-center",
      style: {
        background:
          "linear-gradient(180deg, rgba(1,15,22,0.92) 0%, rgba(1,15,22,0.72) 72%, rgba(1,15,22,0) 100%)",
      },
    },
  }

const PILL: Record<
  CheckoutSkin,
  {
    base: string
    active: string
    inactive: string
    activeStyle?: CSSProperties
    inactiveStyle?: CSSProperties
  }
> = {
  default: {
    base: "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
    active: "border-foreground bg-foreground text-background",
    inactive: "border-border text-muted-foreground hover:text-foreground",
  },
  amanita: {
    base: "flex shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 py-1.5 font-condensed text-xs font-medium uppercase tracking-[0.08em] transition-colors",
    active: "text-sand",
    inactive: "border-white/20 hover:border-mint hover:text-mint",
    activeStyle: {
      backgroundColor: "#0a1424",
      borderColor: "rgba(193,170,136,0.7)",
    },
    inactiveStyle: { color: "rgba(241,235,227,0.78)" },
  },
}

const MAIN_CLASSES: Record<CheckoutSkin, string> = {
  default: "mx-auto w-full max-w-2xl px-4 pb-40 pt-6",
  amanita:
    "relative z-[1] mx-auto w-full max-w-[760px] px-4 pb-48 pt-20 md:pt-24",
}

const BOTTOM_OUTER: Record<
  CheckoutSkin,
  { className: string; style?: CSSProperties }
> = {
  default: { className: "fixed inset-x-0 bottom-0 z-40 px-4 pb-4" },
  amanita: {
    className: "pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3",
    style: { paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" },
  },
}

const BOTTOM_INNER: Record<
  CheckoutSkin,
  { className: string; style?: CSSProperties }
> = {
  default: {
    className:
      "mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-2xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur",
  },
  amanita: {
    className:
      "pointer-events-auto mx-auto flex max-w-[760px] items-center justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3 md:px-6",
    style: {
      backgroundColor: "rgba(3,22,33,0.93)",
      boxShadow: "0 18px 48px rgba(1,15,22,0.65)",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
    },
  },
}

const BACK_BUTTON: Record<
  CheckoutSkin,
  { className: string; style?: CSSProperties }
> = {
  default: {
    className:
      "shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40",
  },
  amanita: {
    className:
      "shrink-0 font-condensed text-xs font-medium uppercase tracking-[0.12em] transition-colors hover:text-cream disabled:opacity-40",
    style: { color: "rgba(241,235,227,0.7)" },
  },
}

const TOTAL_LABEL_CLASSES: Record<CheckoutSkin, string> = {
  default: "text-[10px] uppercase tracking-wider text-muted-foreground",
  amanita:
    "font-condensed text-[0.6rem] font-medium uppercase tracking-[0.24em] text-sand",
}

const TOTAL_VALUE_CLASSES: Record<CheckoutSkin, string> = {
  default: "text-lg font-bold text-foreground",
  amanita: "font-condensed text-lg leading-tight text-cream md:text-xl",
}

const CTA_BUTTON_CLASSES: Record<CheckoutSkin, string> = {
  default:
    "shrink-0 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
  amanita:
    "btn-ornate flex shrink-0 items-center justify-center whitespace-nowrap !px-4 py-2.5 font-condensed text-xs font-medium uppercase tracking-[0.1em] md:!px-6 md:text-sm disabled:cursor-not-allowed disabled:opacity-50",
}

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
  const skin = resolveCheckoutSkin(popup)
  const isAmanita = skin === "amanita"

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

  // Amanita Confirm section's empty-cart CTA ("Ver tickets") — jump to the
  // first product step (i.e. the first section that isn't buyer/confirm).
  const goToFirstProductSection = useCallback(() => {
    const idx = sections.findIndex(
      (s) => s.stepType !== "buyer" && s.stepType !== "confirm",
    )
    goTo(idx >= 0 ? idx : 0)
  }, [sections, goTo])

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
    if (stepType === "buyer")
      return isAmanita ? <AmanitaBuyerStep /> : <OpenCheckoutBuyerStep />
    if (stepType === "confirm")
      return isAmanita ? (
        <AmanitaConfirmSection onGoToTickets={goToFirstProductSection} />
      ) : (
        <ConfirmStep />
      )
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
    <div className={ROOT_CLASSES[skin]}>
      {isAmanita && <AmanitaBackground />}

      {/* pills nav */}
      <nav
        aria-label="Checkout sections"
        className={NAV[skin].className}
        style={NAV[skin].style}
      >
        {navSections.map((section) => {
          const idx = sections.findIndex((s) => s.id === section.id)
          const isActive = idx === active
          const pill = PILL[skin]
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => goTo(idx)}
              aria-current={isActive ? "step" : undefined}
              className={`${pill.base} ${isActive ? pill.active : pill.inactive}`}
              style={isActive ? pill.activeStyle : pill.inactiveStyle}
            >
              {section.label}
            </button>
          )
        })}
        {navExtraContent}
      </nav>

      <CheckoutToast onChipClick={scrollToStep} />

      {/* one section at a time */}
      <main className={MAIN_CLASSES[skin]}>
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
      <div
        className={BOTTOM_OUTER[skin].className}
        style={BOTTOM_OUTER[skin].style}
      >
        <div
          className={BOTTOM_INNER[skin].className}
          style={BOTTOM_INNER[skin].style}
        >
          <button
            type="button"
            onClick={() => goTo(active - 1)}
            disabled={active === 0}
            className={BACK_BUTTON[skin].className}
            style={BACK_BUTTON[skin].style}
          >
            {t("common.back")}
          </button>
          <div className="flex min-w-0 flex-col items-center">
            <span className={TOTAL_LABEL_CLASSES[skin]}>Total</span>
            <span className={TOTAL_VALUE_CLASSES[skin]}>
              {formatCurrency(summary.grandTotal)}
            </span>
          </div>
          {isLast ? (
            <button
              type="button"
              data-testid="stepper-next"
              onClick={handlePayment}
              disabled={!canPay}
              className={CTA_BUTTON_CLASSES[skin]}
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
              className={CTA_BUTTON_CLASSES[skin]}
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
