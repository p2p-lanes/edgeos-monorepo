import { useQuery } from "@tanstack/react-query"
import type { AttendeeCategoryPublic } from "@/client"
import { AttendeeCategoriesService } from "@/client"
import { queryKeys } from "@/lib/query-keys"

export function useAttendeeCategories(popupId: string) {
  const query = useQuery({
    queryKey: queryKeys.attendeeCategories.byPopup(popupId),
    queryFn: async (): Promise<AttendeeCategoryPublic[]> => {
      const result =
        await AttendeeCategoriesService.listAttendeeCategoriesPortal({
          popupId,
        })
      return [...(result.results ?? [])].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      )
    },
    enabled: !!popupId,
    staleTime: 5 * 60 * 1000,
  })

  return {
    categories: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    isSuccess: query.isSuccess,
    error: query.error,
  }
}
