"use client"

import { getBackgroundProps } from "@/lib/background-image"
import { useCityProvider } from "@/providers/cityProvider"
import { useTenant } from "@/providers/tenantProvider"
import { PopupCheckoutContent } from "../components/PopupCheckoutContent"

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
  </div>
)

const PopupCheckoutPage = () => {
  const { tenant } = useTenant()
  const { getCity, popupsLoaded } = useCityProvider()

  const popup = getCity()
  const background = getBackgroundProps(popup, tenant)

  if (!popupsLoaded || !popup) {
    return <LoadingFallback />
  }

  return <PopupCheckoutContent popup={popup} background={background} />
}

export default PopupCheckoutPage
