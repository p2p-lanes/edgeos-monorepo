import { useQuery } from "@tanstack/react-query"
import type { ApplicationsGetMyParticipationResponse } from "@/client"
import { ApplicationsService } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

export function useParticipationQuery(popupId: string | null) {
  const isAuthenticated = useIsAuthenticated()
  return useQuery({
    queryKey: queryKeys.participation.byPopup(popupId ?? ""),
    queryFn: async (): Promise<ApplicationsGetMyParticipationResponse> => {
      return ApplicationsService.getMyParticipation({ popupId: popupId! })
    },
    enabled: popupId != null && isAuthenticated,
  })
}

export default useParticipationQuery
