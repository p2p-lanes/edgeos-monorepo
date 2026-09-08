"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { useSession } from "@/providers/sessionProvider"

const Page = () => {
  const router = useRouter()
  const loggedIn = useIsAuthenticated()
  const { snapshot } = useSession()

  useEffect(() => {
    if (snapshot.status !== "authenticated" && snapshot.status !== "anonymous")
      return
    router.push(loggedIn ? "/portal" : "/auth")
  }, [loggedIn, router, snapshot.status])

  return <Loader fullscreen />
}
export default Page
