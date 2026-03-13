"use client"

import { Suspense } from "react"
import { CheckoutContent } from "@/app/checkout/components/CheckoutContent"
import { getBackgroundProps } from "@/lib/background-image"
import { useCityProvider } from "@/providers/cityProvider"
import { useTenant } from "@/providers/tenantProvider"
import useGetInviteData from "./hook/useGetInviteData"

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
  </div>
)

const InvitePage = () => {
  const { tenant } = useTenant()
  const { getCity } = useCityProvider()
  const {
    data: { group },
    error,
    isLoading,
  } = useGetInviteData()

  const popup = getCity()
  const background = getBackgroundProps(popup, tenant)

  if (isLoading) {
    return <LoadingFallback />
  }

  return (
    <div
      className={`min-h-screen w-full py-8 flex items-center justify-center ${background.className}`}
      style={background.style}
    >
      <div className="container mx-auto">
        <Suspense fallback={<LoadingFallback />}>
          <CheckoutContent
            group={group}
            isLoading={isLoading}
            error={error}
            isInvite={true}
          />
        </Suspense>
      </div>
    </div>
  )
}
export default InvitePage
