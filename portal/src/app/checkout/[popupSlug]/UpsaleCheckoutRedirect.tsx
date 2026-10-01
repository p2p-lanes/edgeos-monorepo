"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"

export function UpsaleCheckoutRedirect({
  popupSlug,
  flowSlug,
}: {
  popupSlug: string
  flowSlug: string
}) {
  const router = useRouter()

  useEffect(() => {
    router.replace(
      `/portal/${encodeURIComponent(popupSlug)}/shop/${encodeURIComponent(flowSlug)}`,
    )
  }, [flowSlug, popupSlug, router])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader />
    </div>
  )
}
