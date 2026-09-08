"use client"

import { queryOptions, useQuery } from "@tanstack/react-query"
import {
  ApiError,
  type CheckoutRuntimeResponse,
  CheckoutService,
  type HumanPublic,
} from "@/client"
import { queryKeys } from "@/lib/query-keys"

export function checkoutRuntimeAudience(
  user: Pick<HumanPublic, "id" | "tenant_id">,
) {
  return `${user.tenant_id}:${user.id}`
}

export function checkoutRuntimeOptions(
  slug: string,
  flowSlug: string,
  language?: string | null,
  audience?: string,
) {
  return queryOptions({
    queryKey: queryKeys.checkout.runtime(slug, flowSlug, language, audience),
    queryFn: () => CheckoutService.getFlowRuntime({ slug, flowSlug }),
    staleTime: 30_000,
    gcTime: 60_000,
    retry: (failureCount, error) => {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      )
        return false
      return failureCount < 3
    },
  })
}

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
    audience?: string
    enabled?: boolean
  },
) {
  return useQuery({
    ...checkoutRuntimeOptions(
      slug,
      opts.flowSlug,
      opts.language,
      opts.audience,
    ),
    enabled: slug.length > 0 && opts.enabled !== false,
    initialData: opts.initialData,
    initialDataUpdatedAt: opts.initialDataUpdatedAt,
  })
}
