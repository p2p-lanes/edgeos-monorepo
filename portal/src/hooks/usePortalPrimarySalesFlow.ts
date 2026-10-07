"use client"

import { useQuery } from "@tanstack/react-query"
import { CheckoutService } from "@/client"

export function usePortalPrimarySalesFlow(popupSlug: string | undefined) {
  return useQuery({
    queryKey: ["portal-primary-sales-flow", popupSlug],
    queryFn: () => CheckoutService.getPrimaryCheckoutFlow({ slug: popupSlug! }),
    enabled: !!popupSlug,
    staleTime: 5 * 60 * 1000,
  })
}
