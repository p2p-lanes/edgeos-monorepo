"use client"

import { useQuery } from "@tanstack/react-query"
import type { SalesFlowPortalPublic } from "@/client"
import { SalesFlowsService } from "@/client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Eligible upsale sales flows for a popup (sdd/sales-flows G0 #2/#3, D8,
 * task 13.3). Separate from `usePortalSalesFlows` (which backs the
 * application FlowPicker) — eligibility is live server-side ("any APPROVED
 * payment in the popup"), so an ineligible or unauthenticated human simply
 * gets an empty list here rather than an error.
 */
export function usePortalUpsaleFlows(popupId: string | undefined) {
  return useQuery<SalesFlowPortalPublic[]>({
    queryKey: queryKeys.salesFlows.portalUpsale(popupId ?? ""),
    queryFn: async () => {
      const result = await SalesFlowsService.listPortalUpsaleFlows({
        popupId: popupId!,
      })
      return result.results
    },
    enabled: !!popupId,
    staleTime: 60 * 1000,
  })
}
