import { useQuery } from "@tanstack/react-query"
import type { AttendeeWithOriginPublic } from "@/client"
import { AttendeesService } from "@/client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Fetches all attendees owned by the current Human for a given popup.
 *
 * Calls `GET /attendees/my/popup/{popup_id}` which returns the union of
 * application-linked and direct-sale attendees, each with an `origin`
 * discriminator field.
 *
 * The query is disabled when `popupId` is null/undefined so callers can
 * safely invoke this hook before the city context is available.
 */
export function useHumanAttendeesQuery(popupId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.attendees.byHumanPopup(popupId ?? ""),
    queryFn: async (): Promise<AttendeeWithOriginPublic[]> => {
      const result = await AttendeesService.listMyAttendeesByPopup({
        popupId: popupId!,
      })
      return result.results
    },
    enabled: popupId != null && popupId !== "",
  })
}

export default useHumanAttendeesQuery
