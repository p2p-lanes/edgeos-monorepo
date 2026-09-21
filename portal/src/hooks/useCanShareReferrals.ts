import { useQuery } from "@tanstack/react-query"
import { InvitesService } from "@/client"
import useAuth from "@/hooks/useAuth"

/**
 * Whether the signed-in attendee may create their own link from this popup.
 *
 * The switch lives on the sales flow they came through, not on the popup, so
 * the popup's own `referrals_enabled` stopped saying anything once it moved.
 * The backend answers with the same gate it applies when the link is created
 * (flow switch, access to the popup, red flag), so the sidebar never offers a
 * screen that would then refuse.
 */
export function useCanShareReferrals(popupId: string | undefined): boolean {
  const { user } = useAuth()
  const { data } = useQuery({
    queryKey: ["referrals", "sharing", popupId ?? ""],
    queryFn: () => InvitesService.getMySharingStatus({ popupId: popupId! }),
    enabled: !!popupId && !!user,
    // Hidden is the safe answer while loading or on error: the entry simply
    // does not show, and nothing else on the page depends on it.
    retry: false,
  })
  return data?.can_share === true
}
