import { useQuery } from "@tanstack/react-query"
import { ApplicationsService } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"

export function useMyTicketsQuery() {
  return useQuery({
    queryKey: ["tickets", "mine"],
    queryFn: async () => {
      return ApplicationsService.listMyTickets()
    },
    enabled: isLoggedIn(),
  })
}

export default useMyTicketsQuery
