import { useQuery } from "@tanstack/react-query"
import type { AttendeeWithOriginPublic } from "@/client"
import { AttendeesService } from "@/client"
import useAuth from "@/hooks/useAuth"
import { queryKeys } from "@/lib/query-keys"

/**
 * Fetches all attendees owned by the current Human for a given popup.
 *
 * Calls `GET /attendees/my/popup/{popup_id}` which returns the union of
 * application-linked and direct-sale attendees, each with an `origin`
 * discriminator field.
 *
 * The query is disabled when `popupId` is null/undefined so callers can
 * safely invoke this hook before the city context is available. It is also
 * disabled when there is no authenticated human — the `/attendees/my/...`
 * endpoint requires auth, so firing it for anonymous users (e.g. on the public
 * /r, /invite, /groups checkout pages) would only produce a 401. Once the user
 * authenticates inline (OTP), `user` becomes set and the query enables itself.
 */
export function useHumanAttendeesQuery(popupId: string | null | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.attendees.byHumanPopup(popupId ?? ""),
    queryFn: async (): Promise<AttendeeWithOriginPublic[]> => {
      const result = await AttendeesService.listMyAttendeesByPopup({
        popupId: popupId!,
      })
      return result.results
    },
    enabled: popupId != null && popupId !== "" && !!user,
  })
}

export default useHumanAttendeesQuery
