import { useQuery } from "@tanstack/react-query"
import type { ApplicationsGetMyParticipationResponse } from "@/client"
import { ApplicationsService } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"
import { queryKeys } from "@/lib/query-keys"

export function useParticipationQuery(popupId: string | null) {
  return useQuery({
    queryKey: queryKeys.participation.byPopup(popupId ?? ""),
    queryFn: async (): Promise<ApplicationsGetMyParticipationResponse> => {
      return ApplicationsService.getMyParticipation({ popupId: popupId! })
    },
    enabled: popupId != null && isLoggedIn(),
  })
}

export default useParticipationQuery
