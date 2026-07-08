import { useQuery } from "@tanstack/react-query"
import { PopupsService } from "@/client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Fetches aggregate recap numbers (events / attendees / days) for an ended
 * popup. Enabled only when a popupId is provided. The endpoint is participant-
 * gated on the backend, so a denied human simply gets no data.
 */
export function useRecapStats(popupId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.recapStats.byPopup(popupId ?? ""),
    queryFn: async () => {
      return PopupsService.getPopupRecapStats({ popupId: popupId! })
    },
    enabled: popupId != null && popupId !== "",
    retry: 1,
  })
}

export default useRecapStats
