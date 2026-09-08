"use client"

import { useRouter } from "next/navigation"
import { type ReactNode, useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import useAuth from "@/hooks/useAuth"
import { getAuthRedirectPath } from "@/lib/safe-return-to"

const Authentication = ({ children }: { children: ReactNode }) => {
  const { user, isUserLoading, isAnonymous } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (isAnonymous) {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`
      router.replace(getAuthRedirectPath(returnTo))
    }
  }, [isAnonymous, router])

  if (isUserLoading || !user) return <Loader fullscreen />

  return children
}

export default Authentication
