"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { Loader } from "@/components/ui/Loader"

interface ApplicationCheckoutRedirectProps {
  popupSlug: string
  flowId: string
}

/**
 * Sends an application flow's buyer to the page that can actually charge
 * them.
 *
 * `/checkout/{popup}/{flow}` used to refuse application flows outright, by
 * type. That asked the wrong question — what separates an anonymous
 * purchase from an application-backed one is who is buying — so the
 * backend now serves them to the people they accepted. The link works.
 *
 * The purchase does not happen here, though. This page submits an
 * anonymous purchase, and an accepted applicant pays through their
 * application: their attendees, their credit, their existing details.
 * Submitting the anonymous one would create a second payment linked to
 * nothing. So the URL resolves and hands over to the portal page that
 * already does this correctly.
 *
 * The selected flow UUID travels in the query so the portal checkout keeps
 * its application, quote, and purchase context without resolving a default.
 */
export function ApplicationCheckoutRedirect({
  popupSlug,
  flowId,
}: ApplicationCheckoutRedirectProps) {
  const router = useRouter()

  useEffect(() => {
    const target = `/portal/${popupSlug}/passes/buy`
    router.replace(`${target}?flow=${flowId}`)
  }, [popupSlug, flowId, router])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader />
    </div>
  )
}
