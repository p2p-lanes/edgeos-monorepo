import { useQuery } from "@tanstack/react-query"
import { ApplicationsService } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"

export function useMyTicketsQuery() {
  const isAuthenticated = useIsAuthenticated()
  return useQuery({
    queryKey: ["tickets", "mine"],
    queryFn: async () => {
      return ApplicationsService.listMyTickets()
    },
    enabled: isAuthenticated,
  })
}

export default useMyTicketsQuery
