"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { useCallback } from "react"
import { HumansService } from "@/client"
import {
  dispatchAuthChange,
  useIsAuthenticated,
} from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

const useAuth = () => {
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useParams()
  const popupSlug = params.popupSlug as string | undefined
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

    if (popupSlug) {
      router.push(`/auth?popup=${popupSlug}`)
    } else {
      router.push("/auth")
    }
  }, [queryClient, router, popupSlug])

  return {
    user,
    isUserLoading,
    isLoggedIn: !!user || isUserLoading,
    isError,
    logout,
  }
}

export default useAuth
