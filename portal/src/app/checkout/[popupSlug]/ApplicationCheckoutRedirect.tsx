"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { Loader } from "@/components/ui/Loader"

interface ApplicationCheckoutRedirectProps {
  popupSlug: string
  flowSlug?: string
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
 * `flowSlug` rides along so the destination can scope itself once it
 * learns to: `/portal/{popup}/passes/buy` is not flow-aware yet, which is
 * its own gap rather than something this redirect can paper over.
 */
export function ApplicationCheckoutRedirect({
  popupSlug,
  flowSlug,
}: ApplicationCheckoutRedirectProps) {
  const router = useRouter()

  useEffect(() => {
    const target = `/portal/${popupSlug}/passes/buy`
    router.replace(flowSlug ? `${target}?flow=${flowSlug}` : target)
  }, [popupSlug, flowSlug, router])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader />
    </div>
  )
}
