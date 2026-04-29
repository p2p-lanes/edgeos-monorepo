import { useQuery } from "@tanstack/react-query"
import { ApplicationsService } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

interface UseApplicationsQueryOptions {
  enabled?: boolean
}

export function useApplicationsQuery(options: UseApplicationsQueryOptions = {}) {
  const isAuthenticated = useIsAuthenticated()
  return useQuery({
    queryKey: queryKeys.applications.mine(),
    queryFn: async () => {
      const result = await ApplicationsService.listMyApplications()
      return result.results
    },
    enabled: isAuthenticated && options.enabled !== false,
  })
}

export default useApplicationsQuery
