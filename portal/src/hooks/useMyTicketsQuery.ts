import { useQuery } from "@tanstack/react-query"
import { ApplicationsService } from "@/client"
import useAuth from "@/hooks/useAuth"

export function useMyTicketsQuery() {
  const { user, isUserLoading } = useAuth()
  const query = useQuery({
    queryKey: ["tickets", "mine", user?.tenant_id, user?.id],
    queryFn: async () => {
      return ApplicationsService.listMyTickets()
    },
    enabled: !!user,
  })
  return { ...query, isLoading: isUserLoading || query.isLoading }
}

export default useMyTicketsQuery
