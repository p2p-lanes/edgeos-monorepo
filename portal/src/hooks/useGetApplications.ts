import { useQuery } from "@tanstack/react-query"
import { ApplicationsService } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"
import { queryKeys } from "@/lib/query-keys"

export function useApplicationsQuery() {
  return useQuery({
    queryKey: queryKeys.applications.mine(),
    queryFn: async () => {
      const result = await ApplicationsService.listMyApplications()
      return result.results
    },
    enabled: isLoggedIn(),
  })
}

export default useApplicationsQuery
