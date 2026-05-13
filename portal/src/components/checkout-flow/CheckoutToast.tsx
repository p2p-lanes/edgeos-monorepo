"use client"

import { AlertCircle, ArrowRight, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"

interface CheckoutToastProps {
  /**
   * Called when the user clicks a step-chip to jump to that section.
   * The funnel container wires this to its `scrollToStep` so the toast
   * stays presentation-only.
   */
  onChipClick?: (stepId: string) => void
  className?: string
}

/**
 * Sticky banner at the top of the checkout surface. Surfaces validation
 * errors raised by the Continuar/Pagar buttons. Persistent (only the
 * dismiss button or `dismissCheckoutToast()` removes it) so the user
 * doesn't lose context mid-correction. Chips on the right let the user
 * jump back to the failing step in one tap.
 */
export default function CheckoutToast({
  onChipClick,
  className,
}: CheckoutToastProps) {
  const { t } = useTranslation()
  const { checkoutToast, dismissCheckoutToast } = useCheckout()
  if (!checkoutToast) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "sticky top-12 z-30 mx-auto max-w-3xl px-4 pt-3",
        className,
      )}
    >
      <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50/95 px-4 py-3 shadow-lg backdrop-blur-sm">
        <AlertCircle className="mt-0.5 w-4 h-4 text-amber-600 shrink-0" />
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-amber-900 leading-snug">
            {checkoutToast.message}
          </p>
          {checkoutToast.chips && checkoutToast.chips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {checkoutToast.chips.map((chip) => (
                <button
                  key={chip.stepId}
                  type="button"
                  onClick={() => onChipClick?.(chip.stepId)}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-200"
                >
                  {chip.label}
                  <ArrowRight className="w-3 h-3" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={dismissCheckoutToast}
          aria-label={t("checkout.toast_dismiss_aria", {
            defaultValue: "Cerrar aviso",
          })}
          className="-mt-1 -mr-1 rounded-md p-1 text-amber-700 hover:bg-amber-100 hover:text-amber-900 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
