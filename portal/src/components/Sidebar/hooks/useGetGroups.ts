import { useQuery } from "@tanstack/react-query"
import { GroupsService } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

export function useGroupsQuery() {
  const isAuthenticated = useIsAuthenticated()
  return useQuery({
    queryKey: queryKeys.groups.mine(),
    queryFn: async () => {
      const result = await GroupsService.listMyGroups()
      return result.results
    },
    enabled: isAuthenticated,
  })
}

export default useGroupsQuery
