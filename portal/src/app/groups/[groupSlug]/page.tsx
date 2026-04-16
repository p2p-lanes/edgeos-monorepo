"use client"

import { useParams } from "next/navigation"
import { PopupCheckoutContent } from "@/app/checkout/components/PopupCheckoutContent"
import useGetPublicGroup from "@/hooks/useGetPublicGroup"
import { getBackgroundProps } from "@/lib/background-image"
import { useCityProvider } from "@/providers/cityProvider"
import { useTenant } from "@/providers/tenantProvider"

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
  </div>
)

const GroupCheckoutPage = () => {
  const params = useParams<{ groupSlug: string }>()
  const { tenant } = useTenant()
  const { getPopups, popupsLoaded } = useCityProvider()
  const { group, loading, error } = useGetPublicGroup(params.groupSlug)

  if (loading || !popupsLoaded) {
    return <LoadingFallback />
  }

  const popup = getPopups().find((item) => item.id === group?.popup_id)

  if (error || !group || !popup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-neutral-900">Group not found</h1>
          <p className="mt-3 text-sm text-neutral-600">
            The group link is invalid or this event is no longer available.
          </p>
        </div>
      </div>
    )
  }

  const background = getBackgroundProps(popup, tenant)

  return (
    <PopupCheckoutContent
      popup={popup}
      background={background}
      groupId={group.id}
    />
  )
}

export default GroupCheckoutPage
