"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"

export function LegacyTicketsRedirect({ popupSlug }: { popupSlug: string }) {
  const router = useRouter()
  const flowIdentifier = useSearchParams().get("flow")?.trim()

  useEffect(() => {
    const query = flowIdentifier
      ? `?${new URLSearchParams({ flow: flowIdentifier })}`
      : ""
    router.replace(`/portal/${popupSlug}/passes${query}`)
  }, [flowIdentifier, popupSlug, router])

  return <Loader />
}
