"use client"

import { useMutation } from "@tanstack/react-query"
import { CheckoutService, type OpenTicketingPurchaseCreate } from "@/client"
import { getMetaAttribution } from "@/lib/meta-pixel"

export function useOpenTicketingPurchase(slug: string) {
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
      window.location.href = response.checkout_url
    },
  })
}
