"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { Loader } from "@/components/ui/Loader"

interface ApplicationCheckoutRedirectProps {
  popupSlug: string
  flowId: string
}

/**
 * Sends an accepted applicant from the public checkout to the authenticated
 * Shop checkout that preserves their attendees, credit, and application.
 * Shop accepts the flow UUID here and canonicalizes it to the readable slug.
 */
export function ApplicationCheckoutRedirect({
  popupSlug,
  flowId,
}: ApplicationCheckoutRedirectProps) {
  const router = useRouter()

  useEffect(() => {
    router.replace(`/portal/${popupSlug}/shop/${flowId}`)
  }, [popupSlug, flowId, router])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader />
    </div>
  )
}
