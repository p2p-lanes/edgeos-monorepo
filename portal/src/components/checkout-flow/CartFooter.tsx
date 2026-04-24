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
import { formatCurrency } from "@/types/checkout"
import CartItemList from "./CartItemList"

interface CartFooterProps {
  onPay?: () => void
  onBack?: () => void
  nextSectionLabel?: string
  onContinue?: () => void
  isLastSection?: boolean
}

export default function CartFooter({
  onPay,
  onBack,
  nextSectionLabel,
  onContinue,
  isLastSection = false,
}: CartFooterProps) {
  const { t } = useTranslation()
  const {
    cart,
    summary,
    currentStep,
    availableSteps,
    attendees,
    goToNextStep,
    goToPreviousStep,
    canProceedToStep,
    isSubmitting,
    isEditing,
    editCredit,
    termsAccepted,
  } = useCheckout()
  const { getCity } = useCityProvider()
  const popup = getCity()

  const [isExpanded, setIsExpanded] = useState(false)

  const isConfirmStep = currentStep === "confirm" || isLastSection
  const isFirstStep = currentStep === "passes"
  const currentIndex = availableSteps.indexOf(currentStep)
  const nextStepId =
    currentIndex < availableSteps.length - 1
      ? availableSteps[currentIndex + 1]
      : null

  const hasEditChanges =
    isEditing && attendees.some((a) => a.products.some((p) => p.edit))
  const requiresTerms =
    isConfirmStep && !!popup?.terms_and_conditions_url && !termsAccepted
  const hasDynamicItems = Object.values(cart.dynamicItems).some(
    (items) => items.length > 0,
  )
  const canContinue = requiresTerms
    ? false
    : isEditing
      ? cart.passes.length > 0
      : isConfirmStep
        ? cart.passes.length > 0 ||
          !!cart.housing ||
          cart.merch.length > 0 ||
          !!cart.patron ||
          hasDynamicItems
        : nextStepId
          ? canProceedToStep(nextStepId)
          : false

  const hasItems =
    summary.itemCount > 0 || hasDynamicItems || (isEditing && hasEditChanges)

  const handleContinue = () => {
    if (isConfirmStep && onPay) {
      onPay()
    } else if (onContinue) {
      onContinue()
    } else {
      goToNextStep()
    }
  }

  return (
    <div className="z-30">
      {isExpanded && (
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
          isExpanded ? "max-h-[60vh]" : "max-h-0",
        )}
      >
        <div className="px-4 py-4 overflow-y-auto max-h-[calc(60vh-80px)]">
          <CartItemList />
        </div>
      </div>

      {/* Floating Footer */}
      <div className="mb-4">
        <div className="backdrop-blur-xl bg-checkout-bottom-bar-bg rounded-2xl shadow-2xl border border-white/10 p-3 lg:p-4">
          <div className="flex items-center gap-2 lg:gap-3">
            {/* Back button */}
            <button
              type="button"
              onClick={isFirstStep ? onBack : goToPreviousStep}
              className="flex items-center justify-center p-2.5 lg:px-3 lg:py-2 text-checkout-bottom-bar-text/60 hover:text-checkout-bottom-bar-text hover:bg-white/10 rounded-lg transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden lg:inline text-sm font-medium ml-1.5">
                {t("common.back")}
              </span>
            </button>

            {/* Center: Total */}
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex-1 flex items-center gap-2 min-w-0 overflow-hidden hover:opacity-80 transition-opacity"
            >
              <div className="flex flex-col items-start min-w-0 overflow-hidden">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] lg:text-xs text-checkout-bottom-bar-text/60 uppercase tracking-wider font-medium">
                    {isEditing ? t("checkout.to_pay") : t("common.total")}
                  </span>
                  {hasItems &&
                    (isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-checkout-bottom-bar-text/60 shrink-0" />
                    ) : (
                      <ChevronUp className="w-3 h-3 text-checkout-bottom-bar-text/60 shrink-0" />
                    ))}
                </div>
                <span className="text-lg lg:text-2xl font-bold text-checkout-bottom-bar-text truncate max-w-full">
                  {formatCurrency(summary.grandTotal)}
                </span>
                {isEditing && editCredit > 0 && (
                  <span className="text-[10px] lg:text-xs text-orange-400 font-medium">
                    {t("checkout.credit_label", {
                      amount: formatCurrency(editCredit),
                    })}
                  </span>
                )}
              </div>
            </button>

            {/* Continue button */}
            <button
              type="button"
              onClick={handleContinue}
              disabled={!canContinue || isSubmitting}
              className={cn(
                "flex items-center justify-center gap-1.5 lg:gap-2 px-3 lg:px-6 py-3 lg:py-3.5 rounded-xl text-sm font-semibold transition-all shrink-0 whitespace-nowrap",
                canContinue && !isSubmitting
                  ? "bg-checkout-button text-checkout-button-title shadow-lg active:scale-95 hover:opacity-90"
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
                  <span>
                    {isEditing
                      ? isConfirmStep
                        ? summary.grandTotal === 0
                          ? t("checkout.actions.confirm_edit")
                          : t("checkout.actions.pay_and_confirm_edit")
                        : (nextSectionLabel ?? t("common.continue"))
                      : isConfirmStep
                        ? summary.grandTotal === 0
                          ? t("checkout.actions.claim_pass")
                          : t("checkout.actions.pay")
                        : (nextSectionLabel ?? t("common.continue"))}
                  </span>
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
