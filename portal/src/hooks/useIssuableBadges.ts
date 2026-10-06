"use client"

import { useQuery } from "@tanstack/react-query"
import { BadgesService, type IssuableBadge } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

/** Badges the signed-in person may give in a popup, with what's left. */
const useIssuableBadges = (popupId: string | undefined) => {
  const isAuthenticated = useIsAuthenticated()

  const query = useQuery<IssuableBadge[]>({
    queryKey: queryKeys.profile.issuableBadges(popupId ?? ""),
    queryFn: () =>
      BadgesService.listIssuableBadges({ popupId: popupId as string }),
    enabled: isAuthenticated && !!popupId,
  })

  return { issuable: query.data ?? [], isLoading: query.isLoading }
}

export default useIssuableBadges
