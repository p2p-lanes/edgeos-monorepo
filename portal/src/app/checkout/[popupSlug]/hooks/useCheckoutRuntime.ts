"use client"

import { useQuery } from "@tanstack/react-query"
import { CheckoutService } from "@/client"
import { queryKeys } from "@/lib/query-keys"

export function useCheckoutRuntime(slug: string) {
  return useQuery({
    queryKey: queryKeys.checkout.runtime(slug),
    queryFn: () => CheckoutService.getRuntime({ slug }),
    enabled: slug.length > 0,
    staleTime: 30_000,
    gcTime: 60_000,
  })
}
