"use client"

import { useRouter } from "next/navigation"
import { type ReactNode, useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { getAuthRedirectPath } from "@/lib/safe-return-to"
import { hasVerifiedSession } from "@/lib/session-contract"
import { SessionRecovery, useSession } from "@/providers/sessionProvider"

const Authentication = ({ children }: { children: ReactNode }) => {
  const { snapshot, lifecycle } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (snapshot.status === "anonymous") {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`
      router.replace(getAuthRedirectPath(returnTo))
    }
  }, [snapshot.status, router])

  if (hasVerifiedSession(snapshot)) return children
  if (
    snapshot.status === "unavailable" ||
    snapshot.status === "authenticated"
  ) {
    return (
      <SessionRecovery
        onRetry={() => {
          void lifecycle.retry()
        }}
        onSignIn={() =>
          router.replace(
            getAuthRedirectPath(
              `${window.location.pathname}${window.location.search}${window.location.hash}`,
            ),
          )
        }
      />
    )
  }

  return <Loader fullscreen />
}

export default Authentication
