"use client"

import { useRouter } from "next/navigation"
import { type ReactNode, useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import useAuth from "@/hooks/useAuth"
import { getAuthRedirectPath } from "@/lib/safe-return-to"

const Authentication = ({ children }: { children: ReactNode }) => {
  const { user, isUserLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isUserLoading && !user) {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`
      router.replace(getAuthRedirectPath(returnTo))
    }
  }, [user, isUserLoading, router])

  if (isUserLoading || !user) return <Loader />

  return children
}

export default Authentication
