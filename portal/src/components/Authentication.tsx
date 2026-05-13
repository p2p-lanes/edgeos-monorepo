"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { type ReactNode, useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import useAuth from "@/hooks/useAuth"

const Authentication = ({ children }: { children: ReactNode }) => {
  const { user, isUserLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!isUserLoading && !user) {
      const query = searchParams.toString()
      const returnTo = `${pathname}${query ? `?${query}` : ""}`
      router.replace(`/auth?returnTo=${encodeURIComponent(returnTo)}`)
    }
  }, [user, isUserLoading, pathname, router, searchParams])

  if (isUserLoading || !user) return <Loader />

  return children
}

export default Authentication
