import { useQuery } from "@tanstack/react-query"
import { ApplicationsService } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"
import { queryKeys } from "@/lib/query-keys"

export function usePurchasesQuery(popupId: string | null) {
  return useQuery({
    queryKey: queryKeys.purchases.byPopup(popupId ?? ""),
    queryFn: () => ApplicationsService.getMyPurchases({ popupId: popupId! }),
    enabled: !!popupId && isLoggedIn(),
  })
}
