"use client"

import { useTranslation } from "react-i18next"
import { useOpenCheckoutQuote } from "@/hooks/checkout/useOpenCheckoutQuote"

export function OpenCheckoutQuoteStatus({
  popupSlug,
  flowSlug,
}: {
  popupSlug: string
  flowSlug: string
}) {
  const { t } = useTranslation()
  const { data: quote } = useOpenCheckoutQuote({ popupSlug, flowSlug })

  if (!quote) return null

  const amount = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: quote.currency,
  }).format(Number(quote.total))
  const label =
    quote.kind === "definitive"
      ? t("shop.definitive_total")
      : t("shop.estimated_total")

  return (
    <p aria-live="polite" className="text-xs text-muted-foreground">
      {label}: {amount}
    </p>
  )
}
