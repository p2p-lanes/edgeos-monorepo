"use client"

import { useQuery } from "@tanstack/react-query"
import { type HumanPublic, HumansService } from "@/client"
import { queryKeys } from "@/lib/query-keys"
import { hasVerifiedSession } from "@/lib/session-contract"
import { useSession } from "@/providers/sessionProvider"

const useAuth = () => {
  const { snapshot, lifecycle } = useSession()
  const isAuthenticated = hasVerifiedSession(snapshot)

  const {
    data: user = null,
    isLoading: isUserLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.profile.current,
    queryFn: async () => HumansService.getCurrentHumanInfo(),
    enabled: isAuthenticated,
  })

  return {
    user: isAuthenticated
      ? ((user ?? snapshot.session?.human ?? null) as HumanPublic | null)
      : null,
    isUserLoading:
      snapshot.status === "unknown" ||
      snapshot.status === "changing" ||
      isUserLoading,
    isLoggedIn: isAuthenticated,
    isAnonymous: snapshot.status === "anonymous",
    isError,
    logout: () => lifecycle.logout("/auth"),
  }
}

export default useAuth
