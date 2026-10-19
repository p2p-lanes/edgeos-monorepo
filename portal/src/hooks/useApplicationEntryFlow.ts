"use client"

import { useQuery } from "@tanstack/react-query"
import { ApiError, SalesFlowsService } from "@/client"
import { queryKeys } from "@/lib/query-keys"

/** Resolve an explicit entry separately from the portal's discovery list. */
export function useApplicationEntryFlow(
  popupId: string | undefined,
  identifier: string | null,
) {
  return useQuery({
    queryKey: queryKeys.salesFlows.applicationEntry(popupId ?? "", identifier),
    queryFn: async () => {
      try {
        let entryIdentifier = identifier
        if (!entryIdentifier) {
          const { results } = await SalesFlowsService.listPortalSalesFlows({
            popupId: popupId!,
          })
          if (results.length !== 1) return null
          entryIdentifier = results[0].id
        }
        return await SalesFlowsService.resolvePortalApplicationFlow({
          popupId: popupId!,
          identifier: entryIdentifier,
        })
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 403 || error.status === 404)
        ) {
          return null
        }
        throw error
      }
    },
    enabled: !!popupId,
    // Recheck entry gates when reopening a link, including a recently closed flow.
    staleTime: 0,
  })
}
