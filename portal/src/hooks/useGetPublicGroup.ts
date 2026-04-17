import { useQuery } from "@tanstack/react-query"
import { ApiError, type GroupPublic, GroupsService } from "@/client"
import { queryKeys } from "@/lib/query-keys"

interface UseGetPublicGroupResult {
  group: GroupPublic | null
  loading: boolean
  error: string | null
}

const useGetPublicGroup = (
  groupSlug: string | null,
): UseGetPublicGroupResult => {
  const query = useQuery({
    queryKey: queryKeys.groups.public(groupSlug ?? ""),
    queryFn: async () => {
      return GroupsService.getGroupPublic({ groupSlug: groupSlug! })
    },
    enabled: Boolean(groupSlug),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) {
        return false
      }

      return failureCount < 1
    },
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return {
    group: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
  }
}

export default useGetPublicGroup
