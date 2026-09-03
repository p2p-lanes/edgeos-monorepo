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
  opts: {
    /**
     * Language the request will carry (see `resolveRequestLanguage`). Part of
     * the key because the response is translated: without it the server render's
     * payload stays "fresh" under the same key for the whole staleTime, so a
     * visitor whose stored language differs from the one SSR used keeps seeing
     * the wrong language until an unrelated refetch happens to fire.
     */
    language?: string | null
    /**
     * Canonical sales flow URL segment.
     */
    flowSlug: string
    initialData?: CheckoutRuntimeResponse
    initialDataUpdatedAt?: number
  },
) {
  return useQuery({
    queryKey: queryKeys.checkout.runtime(slug, opts.flowSlug, opts.language),
    queryFn: () =>
      CheckoutService.getFlowRuntime({ slug, flowSlug: opts.flowSlug }),
    enabled: slug.length > 0,
    staleTime: 30_000,
    gcTime: 60_000,
    initialData: opts.initialData,
    initialDataUpdatedAt: opts.initialDataUpdatedAt,
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
