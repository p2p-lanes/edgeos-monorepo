"use client"

import { useQuery } from "@tanstack/react-query"
import type { SalesFlowPublic } from "@/client"
import { SalesFlowsService } from "@/client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Portal-listed application flows for a popup (sdd/sales-flows G0, task
 * 9.4). Backs the FlowPicker — shown by the caller only when more than one
 * flow is returned. `direct_url_only` flows and non-application flows never
 * appear (backend-filtered).
 */
export function usePortalSalesFlows(popupId: string | undefined) {
  return useQuery<SalesFlowPublic[]>({
    queryKey: queryKeys.salesFlows.portal(popupId ?? ""),
    queryFn: async () => {
      const result = await SalesFlowsService.listPortalSalesFlows({
        popupId: popupId!,
      })
      return result.results
    },
    enabled: !!popupId,
    staleTime: 5 * 60 * 1000,
  })
}
