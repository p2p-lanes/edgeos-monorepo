"use client"

import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import type { CheckoutStep } from "@/types/checkout"
import { formatCurrency } from "@/types/checkout"
import CartItemList from "./CartItemList"

interface CartFooterProps {
  onPay?: () => void
  onBack?: () => void
  nextSectionLabel?: string
  onContinue?: () => void
  /** Scroll-based "previous step" handler from the funnel container.
   *  Volver uses this when present because the provider's
   *  `goToPreviousStep` only updates internal state — in scrolly mode
   *  it leaves the page parked on the current section. */
  onPrevious?: () => void
  /** Provided by the funnel container so this component can jump back
   *  to a failing step when the user clicks Continuar/Pagar without
   *  filling required fields. */
  onScrollToStep?: (stepId: string) => void
  isLastSection?: boolean
  activeSectionId?: string
}

// Past this character count we fall back to a generic "Continuar →" on
// the Continue pill so the bottom bar doesn't break the row on mobile.
const NEXT_LABEL_MOBILE_THRESHOLD = 14

export default function CartFooter({
  onPay,
  onBack,
  nextSectionLabel,
  onContinue,
  onPrevious,
  onScrollToStep,
  isLastSection = false,
  activeSectionId,
}: CartFooterProps) {
  const { t } = useTranslation()
  const {
    summary,
    currentStep,
    availableSteps,
    attendees,
    goToNextStep,
    goToPreviousStep,
    isSubmitting,
    isEditing,
    termsAccepted,
    isBuyerInfoComplete,
    cartUiEnabled,
    hasAnyCartItems,
    getBuyerInvalidFields,
    findFirstIncompleteStep,
    findFirstProductStep,
    markBuyerFieldsTouched,
    triggerCheckoutToast,
    dismissCheckoutToast,
    visitedSteps,
  } = useCheckout()
  const { getCity } = useCityProvider()
  const popup = getCity()

  const [isExpanded, setIsExpanded] = useState(false)

  // In scrolly mode `currentStep` stays at the initial value while the
  // user scrolls. `activeSectionId` reflects the section actually in
  // view, so position-based gating (first step, confirm step, …) must
  // use it when provided to avoid letting users skip required steps.
  const positionStep = (activeSectionId ?? currentStep) as CheckoutStep
  const isConfirmStep = positionStep === "confirm" || isLastSection
  const isBuyerStep = positionStep === ("buyer" as CheckoutStep)
  const currentIndex = availableSteps.indexOf(positionStep)
  // First step is whatever sits at index 0 of the configured step order
  // — previously hardcoded to "passes", which broke once popups started
  // putting buyer or hero steps first.
  const isFirstStep = currentIndex === 0

  const hasEditChanges =
    isEditing && attendees.some((a) => a.products.some((p) => p.edit))
  const requiresTerms =
    isConfirmStep && !!popup?.terms_and_conditions_url && !termsAccepted
  const hasItems =
    summary.itemCount > 0 || hasAnyCartItems || (isEditing && hasEditChanges)

  // Focus the first invalid field within a given step's section after
  // React re-renders the inline errors (so the right input has
  // aria-invalid="true" by the time we look it up). Idempotent.
  const focusFirstInvalidInStep = (stepId: string) => {
    if (typeof document === "undefined") return
    window.setTimeout(() => {
      const section = document.getElementById(stepId)
      if (!section) return
      const target = section.querySelector<HTMLElement>('[aria-invalid="true"]')
      target?.focus({ preventScroll: true })
    }, 250)
  }

  const handleContinue = () => {
    if (isSubmitting) return

    // --- Path A: confirm / pay attempt ------------------------------
    // Resolution order is funnel-order: bounce the user back to the
    // earliest fixable thing, not the closest. Required-input gaps
    // (today: buyer info) come first because the buyer step lives
    // before any product step in the funnel; the cart-empty check
    // fires next once the buyer has filled their info.
    if (isConfirmStep) {
      if (requiresTerms) return
      const incomplete = findFirstIncompleteStep()
      if (incomplete) {
        if (incomplete === "buyer") {
          markBuyerFieldsTouched(getBuyerInvalidFields())
        }
        onScrollToStep?.(incomplete)
        focusFirstInvalidInStep(incomplete)
        triggerCheckoutToast({
          message: t("checkout.toast_buyer_incomplete_pay", {
            defaultValue:
              "Antes de pagar, completá los campos de Tu información.",
          }),
          chips: [
            {
              label: t("checkout.step_short.buyer", {
                defaultValue: "Tu información",
              }),
              stepId: incomplete,
            },
          ],
        })
        return
      }
      if (!hasItems) {
        const target = findFirstProductStep(visitedSteps)
        if (target) onScrollToStep?.(target)
        triggerCheckoutToast({
          message: t("checkout.toast_cart_empty", {
            defaultValue:
              "Necesitás agregar al menos un item antes de continuar.",
          }),
        })
        return
      }
      dismissCheckoutToast()
      onPay?.()
      return
    }

    // --- Path B: Continuar from the buyer step ----------------------
    // Local gate — don't let the user "advance forward" while leaving
    // the form invalid behind them. Reveals all invalid fields, focuses
    // the first one, raises the toast.
    if (isBuyerStep && !isBuyerInfoComplete) {
      markBuyerFieldsTouched(getBuyerInvalidFields())
      focusFirstInvalidInStep("buyer")
      triggerCheckoutToast({
        message: t("checkout.toast_buyer_incomplete_continue", {
          defaultValue:
            "Hay datos incompletos en Tu información. Revisalos para continuar.",
        }),
      })
      return
    }

    // --- Path C: any other step ------------------------------------
    dismissCheckoutToast()
    if (onContinue) {
      onContinue()
    } else {
      goToNextStep()
    }
  }

  // New gating model — "enabled by default; click runs validation".
  // The button renders disabled in only two states where it truly has
  // no work to do: a submit in flight, or the terms-acceptance gate on
  // the confirm step. Everywhere else the click triggers validation and
  // either jumps to the failing step + raises the toast on failure, or
  // advances / pays on success.
  const isHardDisabled = isSubmitting || requiresTerms

  // CTA label resolution. Named "Continuar a <Step>" is the desktop
  // default; on narrow viewports or long labels we fall back to the
  // generic "Continuar" so the pill stays predictable.
  const longNextLabel =
    !!nextSectionLabel && nextSectionLabel.length > NEXT_LABEL_MOBILE_THRESHOLD
  const continueText = isEditing
    ? isConfirmStep
      ? summary.grandTotal === 0
        ? t("checkout.actions.confirm_edit")
        : t("checkout.actions.pay_and_confirm_edit")
      : nextSectionLabel
        ? longNextLabel
          ? t("common.continue")
          : nextSectionLabel
        : t("common.continue")
    : isConfirmStep
      ? summary.grandTotal === 0
        ? t("checkout.actions.claim_pass")
        : t("checkout.actions.pay")
      : nextSectionLabel
        ? longNextLabel
          ? t("common.continue")
          : nextSectionLabel
        : t("common.continue")

  return (
    <div className="z-30">
      {cartUiEnabled && isExpanded && (
        <button
          type="button"
          aria-label={t("checkout.cart.close_aria")}
          className="fixed inset-0 z-20 cursor-default"
          onClick={() => setIsExpanded(false)}
        />
      )}

      {/* Expanded Cart Drawer */}
      <div
        className={cn(
          "bg-checkout-card-bg shadow-2xl transition-all duration-300 ease-in-out overflow-hidden rounded-2xl mb-2 relative z-30",
          cartUiEnabled && isExpanded ? "max-h-[60vh]" : "max-h-0",
        )}
      >
        <div className="px-4 py-4 overflow-y-auto max-h-[calc(60vh-80px)]">
          <CartItemList />
        </div>
      </div>

      {/* Floating Footer */}
      <div className="mb-4">
        <div className="backdrop-blur-xl bg-checkout-bottom-bar-bg rounded-2xl shadow-2xl border border-checkout-bottom-bar-border p-3 lg:p-4">
          <div className="flex items-center gap-2 lg:gap-3">
            {/* Back button — hidden on the first step when there's no upstream onBack handler */}
            {(!isFirstStep || onBack) && (
              <button
                type="button"
                onClick={
                  isFirstStep ? onBack : (onPrevious ?? goToPreviousStep)
                }
                className="flex items-center justify-center p-2.5 lg:px-3 lg:py-2 text-checkout-bottom-bar-text/60 hover:text-checkout-bottom-bar-text hover:bg-white/10 rounded-lg transition-colors shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden lg:inline text-sm font-medium ml-1.5">
                  {t("common.back")}
                </span>
              </button>
            )}

            {/* Center: Total */}
            <button
              type="button"
              onClick={() => {
                if (cartUiEnabled) {
                  setIsExpanded(!isExpanded)
                }
              }}
              className="flex-1 flex items-center gap-2 min-w-0 overflow-hidden hover:opacity-80 transition-opacity"
            >
              <div className="flex flex-col items-start min-w-0 overflow-hidden">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] lg:text-xs text-checkout-bottom-bar-accent uppercase tracking-wider font-medium">
                    {isEditing ? t("checkout.to_pay") : t("common.total")}
                  </span>
                  {cartUiEnabled &&
                    hasItems &&
                    (isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-checkout-bottom-bar-text/60 shrink-0" />
                    ) : (
                      <ChevronUp className="w-3 h-3 text-checkout-bottom-bar-text/60 shrink-0" />
                    ))}
                </div>
                <span className="text-lg lg:text-2xl font-bold text-checkout-bottom-bar-text truncate max-w-full">
                  {formatCurrency(summary.grandTotal)}
                </span>
                {summary.creditApplied > 0 && (
                  <span className="text-[10px] lg:text-xs text-orange-400 font-medium">
                    {t("checkout.credit_label", {
                      amount: formatCurrency(summary.creditApplied),
                    })}
                  </span>
                )}
              </div>
            </button>

            {/* Continue button — enable-and-validate: stays enabled unless
                a submit is in flight or terms are pending. Click triggers
                handleContinue, which runs validation and either advances
                or scroll-jumps to the failing step + raises the toast. */}
            <button
              type="button"
              onClick={handleContinue}
              disabled={isHardDisabled}
              className={cn(
                "flex items-center justify-center gap-1.5 lg:gap-2 px-3 lg:px-6 py-3 lg:py-3.5 rounded-xl text-sm font-semibold transition-all shrink-0 whitespace-nowrap",
                !isHardDisabled
                  ? "bg-checkout-button text-checkout-button-title border border-checkout-button-border shadow-lg active:scale-95 hover:opacity-90"
                  : "bg-checkout-button-disabled text-checkout-button-title-disabled cursor-not-allowed",
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t("common.processing")}</span>
                </>
              ) : (
                <>
                  <span>{continueText}</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
