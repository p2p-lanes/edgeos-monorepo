"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { getBackgroundProps } from "@/lib/background-image"
import { getPublicGroupPath } from "@/lib/group-route"
import { useCityProvider } from "@/providers/cityProvider"
import { PopupCheckoutContent } from "../components/PopupCheckoutContent"

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
  </div>
)

const PopupCheckoutPage = () => {
  const params = useParams<{ popupSlug: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { getPopups, popupsLoaded } = useCityProvider()
  const groupSlug = searchParams.get("group")

  useEffect(() => {
    if (!groupSlug) return

    router.replace(getPublicGroupPath(groupSlug))
  }, [groupSlug, router])

  if (groupSlug) {
    return <LoadingFallback />
  }

  const popups = getPopups()
  const popupFromSlug = popups.find((item) => item.slug === params.popupSlug)

  if (!popupsLoaded) {
    return <LoadingFallback />
  }

  if (!popupFromSlug) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-neutral-900">
            Event not found
          </h1>
          <p className="mt-3 text-sm text-neutral-600">
            The checkout link is invalid or this event is no longer available.
          </p>
        </div>
      </div>
    )
  }

  const background = getBackgroundProps(popupFromSlug)

  return <PopupCheckoutContent popup={popupFromSlug} background={background} />
}

export default PopupCheckoutPage
