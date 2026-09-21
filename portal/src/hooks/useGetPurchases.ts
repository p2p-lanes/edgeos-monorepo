import { useQuery } from "@tanstack/react-query"
import { ApplicationsService } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

export function usePurchasesQuery(popupId: string | null, enabled = true) {
  const isAuthenticated = useIsAuthenticated()
  return useQuery({
    queryKey: queryKeys.purchases.byPopup(popupId ?? ""),
    // Ownership comes from active attendee product units, not payment history.
    // Payment snapshots intentionally remain immutable after cancellation.
    queryFn: () => ApplicationsService.getMyPurchases({ popupId: popupId! }),
    enabled: enabled && !!popupId && isAuthenticated,
  })
}
