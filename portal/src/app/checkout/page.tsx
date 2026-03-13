"use client"

import { Suspense } from "react"
import { getBackgroundProps } from "@/lib/background-image"
import { useCityProvider } from "@/providers/cityProvider"
import { useTenant } from "@/providers/tenantProvider"
import { CheckoutContent } from "./components/CheckoutContent"
import useGetCheckoutData from "./hooks/useGetCheckoutData"

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
  </div>
)

const CheckoutPage = () => {
  const { tenant } = useTenant()
  const { getCity } = useCityProvider()
  const {
    data: { group },
    error,
    isLoading,
  } = useGetCheckoutData()

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
          <CheckoutContent group={group} isLoading={isLoading} error={error} />
        </Suspense>
      </div>
    </div>
  )
}

export default CheckoutPage
