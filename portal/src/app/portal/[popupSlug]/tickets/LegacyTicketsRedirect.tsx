"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"

export function LegacyTicketsRedirect({ popupSlug }: { popupSlug: string }) {
  const router = useRouter()

  useEffect(() => {
    router.replace(`/portal/${popupSlug}/tickets`)
  }, [popupSlug, router])

  return <Loader />
}
