"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useCallback } from "react"
import { HumansService } from "@/client"
import {
  dispatchAuthChange,
  useIsAuthenticated,
} from "@/hooks/useIsAuthenticated"
import { saveAuthRedirect } from "@/lib/authRedirect"
import { queryKeys } from "@/lib/query-keys"

const useAuth = () => {
  const router = useRouter()
  const queryClient = useQueryClient()
  const isAuthenticated = useIsAuthenticated()

  const {
    data: user = null,
    isLoading: isUserLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.profile.current,
    queryFn: async () => HumansService.getCurrentHumanInfo(),
    enabled: isAuthenticated,
  })

  const logout = useCallback(() => {
    localStorage.removeItem("token")
    dispatchAuthChange()
    queryClient.clear()

    saveAuthRedirect(`${window.location.pathname}${window.location.search}`)
    router.push("/auth")
  }, [queryClient, router])

  return {
    user,
    isUserLoading,
    isLoggedIn: !!user || isUserLoading,
    isError,
    logout,
  }
}

export default useAuth
