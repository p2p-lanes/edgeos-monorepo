"use client"

import { useRouter } from "next/navigation"
import { type ReactNode, useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { useStoredTokenInfo } from "@/hooks/useIsAuthenticated"
import useAuth from "@/hooks/useAuth"
import { clearStoredToken, isCheckoutOnlyToken } from "@/lib/auth-token"

const Authentication = ({ children }: { children: ReactNode }) => {
  const { user, isUserLoading } = useAuth()
  const tokenInfo = useStoredTokenInfo()
  const isCheckoutOnly = isCheckoutOnlyToken(tokenInfo)
  const router = useRouter()

  useEffect(() => {
    if (isCheckoutOnly) {
      // The lighter checkout token is not authorized for /portal/* — drop it
      // and force a full OTP login before granting portal access.
      clearStoredToken()
      router.replace("/auth")
      return
    }
    if (!isUserLoading && !user) {
      router.replace("/auth")
    }
  }, [user, isUserLoading, router, isCheckoutOnly])

  if (isCheckoutOnly || isUserLoading || !user) return <Loader />

  return children
}

export default Authentication
