"use client"

import { useQuery } from "@tanstack/react-query"
import {
  ApiError,
  type CheckoutRuntimeResponse,
  CheckoutService,
} from "@/client"
import { queryKeys } from "@/lib/query-keys"

export function useCheckoutRuntime(
  slug: string,
  opts?: {
    initialData?: CheckoutRuntimeResponse
    initialDataUpdatedAt?: number
  },
) {
  return useQuery({
    queryKey: queryKeys.checkout.runtime(slug),
    queryFn: () => CheckoutService.getRuntime({ slug }),
    enabled: slug.length > 0,
    staleTime: 30_000,
    gcTime: 60_000,
    initialData: opts?.initialData,
    initialDataUpdatedAt: opts?.initialDataUpdatedAt,
    retry: (failureCount, error) => {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        return false
      }
      return failureCount < 3
    },
  })
}
