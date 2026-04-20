"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { getPublicGroupPath } from "@/lib/group-route"

const CheckoutPage = () => {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const popupSlug = searchParams.get("popup")
    const groupSlug = searchParams.get("group")

    if (groupSlug) {
      router.replace(getPublicGroupPath(groupSlug))
      return
    }

    if (popupSlug) {
      router.replace(`/checkout/${popupSlug}`)
      return
    }

    router.replace("/portal")
  }, [router, searchParams])

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
    </div>
  )
}

export default CheckoutPage
