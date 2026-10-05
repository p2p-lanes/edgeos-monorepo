"use client"

import { useQuery } from "@tanstack/react-query"
import { BadgesService, type MyBadge } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

const useMyBadges = () => {
  const isAuthenticated = useIsAuthenticated()

  const query = useQuery<MyBadge[]>({
    queryKey: queryKeys.profile.badges,
    queryFn: () => BadgesService.listMyBadges(),
    enabled: isAuthenticated,
  })

  return {
    badges: query.data ?? [],
    isLoading: query.isLoading,
  }
}

export default useMyBadges
