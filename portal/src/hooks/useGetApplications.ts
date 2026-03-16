import { useQuery } from "@tanstack/react-query"
import { ApplicationsService } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

export function useApplicationsQuery() {
  const isAuthenticated = useIsAuthenticated()
  return useQuery({
    queryKey: queryKeys.applications.mine(),
    queryFn: async () => {
      const result = await ApplicationsService.listMyApplications()
      return result.results
    },
    enabled: isAuthenticated,
  })
}

export default useApplicationsQuery
