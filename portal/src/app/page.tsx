"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"

const Page = () => {
  const router = useRouter()
  const loggedIn = useIsAuthenticated()

  useEffect(() => {
    router.push(loggedIn ? "/portal" : "/auth")
  }, [loggedIn, router])

  return <Loader />
}
export default Page
