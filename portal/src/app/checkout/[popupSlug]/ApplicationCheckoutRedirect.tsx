"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { Loader } from "@/components/ui/Loader"

interface ApplicationCheckoutRedirectProps {
  popupSlug: string
  flowId: string
  returnContext?: "direct" | "portal"
}

/**
 * Sends an accepted applicant from the public checkout to the authenticated
 * Shop checkout that preserves their attendees, credit, and application.
 * Shop accepts the flow UUID here and canonicalizes it to the readable slug.
 */
export function ApplicationCheckoutRedirect({
  popupSlug,
  flowId,
  returnContext = "direct",
}: ApplicationCheckoutRedirectProps) {
  const router = useRouter()

  useEffect(() => {
    const query = returnContext === "direct" ? "?return_context=direct" : ""
    router.replace(`/portal/${popupSlug}/shop/${flowId}${query}`)
  }, [popupSlug, flowId, returnContext, router])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader />
    </div>
  )
}
