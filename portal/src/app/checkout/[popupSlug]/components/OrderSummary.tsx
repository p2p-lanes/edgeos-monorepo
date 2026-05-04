"use client"

import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/types/checkout"

interface OrderSummaryProps {
  totalQuantity: number
  subtotal: number
  discountPercent: number
  total: number
  canSubmit: boolean
  isSubmitting: boolean
  onSubmit: () => void
}

export function OrderSummary({
  totalQuantity,
  subtotal,
  discountPercent,
  total,
  canSubmit,
  isSubmitting,
  onSubmit,
}: OrderSummaryProps) {
  const { t } = useTranslation()
  return (
    <section className="sticky bottom-4 space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
      <div>
        <h2 className="text-xl font-semibold">
          {t("openCheckout.summary_title")}
        </h2>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span>{t("openCheckout.summary_tickets")}</span>
          <span>{totalQuantity}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t("openCheckout.summary_subtotal")}</span>
          <span>{formatCurrency(subtotal)}</span>
        </div>
        {discountPercent > 0 ? (
          <div className="flex items-center justify-between text-emerald-600">
            <span>{t("openCheckout.summary_discount")}</span>
            <span>-{discountPercent}%</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
          <span>{t("openCheckout.summary_total")}</span>
          <span>{formatCurrency(total)}</span>
        </div>
      </div>

      <Button
        type="button"
        className="w-full"
        disabled={!canSubmit || isSubmitting}
        onClick={onSubmit}
      >
        {isSubmitting
          ? t("openCheckout.summary_redirecting")
          : t("openCheckout.summary_pay")}
      </Button>
    </section>
  )
}
