"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { type ReactNode, useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import useAuth from "@/hooks/useAuth"
import { saveAuthRedirect } from "@/lib/authRedirect"

const Authentication = ({ children }: { children: ReactNode }) => {
  const { user, isUserLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryString = searchParams.toString()

  useEffect(() => {
    if (!isUserLoading && !user) {
      saveAuthRedirect(queryString ? `${pathname}?${queryString}` : pathname)
      router.replace("/auth")
    }
  }, [user, isUserLoading, pathname, queryString, router])

  if (isUserLoading || !user) return <Loader />

  return children
}

export default Authentication
