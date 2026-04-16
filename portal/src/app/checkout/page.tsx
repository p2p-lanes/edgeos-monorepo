"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"

const CheckoutPage = () => {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    // Direct-sale entry point — the portal's primary direct-sale UI lives at
    // `/portal/{popupSlug}`, so forward the user there. The existing
    // `?group=` flow is handled by the downstream group-checkout UI.
    const popupSlug = searchParams.get("popup")
    if (popupSlug) {
      router.replace(`/portal/${popupSlug}`)
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
