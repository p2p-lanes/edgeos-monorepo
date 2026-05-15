"use client"

import { useQuery } from "@tanstack/react-query"
import { type HumanProfileStats, HumansService } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

const useGetProfileStats = () => {
  const isAuthenticated = useIsAuthenticated()

  const query = useQuery<HumanProfileStats>({
    queryKey: queryKeys.profile.stats,
    queryFn: () => HumansService.getCurrentHumanProfileStats(),
    enabled: isAuthenticated,
  })

  return {
    stats: query.data ?? null,
    isLoading: query.isLoading,
  }
}

export default useGetProfileStats
