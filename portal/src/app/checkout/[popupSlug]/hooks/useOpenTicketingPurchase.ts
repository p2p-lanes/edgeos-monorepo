"use client"

import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { CheckoutService, type OpenTicketingPurchaseCreate } from "@/client"
import { withCheckoutLocale } from "@/helpers/checkout"
import { getMetaAttribution } from "@/lib/meta-pixel"

export function useOpenTicketingPurchase(slug: string) {
  const { i18n } = useTranslation()
  return useMutation({
    mutationFn: (requestBody: OpenTicketingPurchaseCreate) =>
      CheckoutService.purchaseOpenTicketing({
        slug,
        requestBody: {
          ...getMetaAttribution(),
          ...requestBody,
        },
      }),
    onSuccess: (response) => {
      window.location.href = withCheckoutLocale(
        response.checkout_url,
        i18n.language,
      )
    },
  })
}
