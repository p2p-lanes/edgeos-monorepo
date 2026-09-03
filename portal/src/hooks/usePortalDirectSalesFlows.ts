"use client"

import { useQuery } from "@tanstack/react-query"
import type { SalesFlowPortalPublic } from "@/client"
import { SalesFlowsService } from "@/client"
import { queryKeys } from "@/lib/query-keys"

export function usePortalDirectSalesFlows(popupId: string | undefined) {
  return useQuery<SalesFlowPortalPublic[]>({
    queryKey: queryKeys.salesFlows.portalDirect(popupId ?? ""),
    queryFn: async () => {
      const result = await SalesFlowsService.listPortalDirectSalesFlows({
        popupId: popupId!,
      })
      return result.results
    },
    enabled: !!popupId,
    staleTime: 5 * 60 * 1000,
  })
}
