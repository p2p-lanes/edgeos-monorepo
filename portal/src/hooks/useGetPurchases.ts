import { useQuery } from "@tanstack/react-query"
import { ApplicationsService } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

export function usePurchasesQuery(popupId: string | null) {
  const isAuthenticated = useIsAuthenticated()
  return useQuery({
    queryKey: queryKeys.purchases.byPopup(popupId ?? ""),
    queryFn: () => ApplicationsService.getMyPurchases({ popupId: popupId! }),
    enabled: !!popupId && isAuthenticated,
  })
}
