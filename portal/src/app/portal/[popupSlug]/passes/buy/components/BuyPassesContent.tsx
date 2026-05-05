"use client"

import { useParams, useRouter } from "next/navigation"
import ScrollyCheckoutFlow from "@/components/checkout-flow/ScrollyCheckoutFlow"
import { Loader } from "@/components/ui/Loader"
import { getBackgroundProps } from "@/lib/background-image"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import PassesProvider, { usePassesProvider } from "@/providers/passesProvider"

export default function BuyPassesContent() {
  const params = useParams()
  const router = useRouter()
  const { attendeePasses: attendees, products } = usePassesProvider()
  const { getCity } = useCityProvider()
  const background = getBackgroundProps(getCity())

  const handleBack = () => {
    router.push(`/portal/${params.popupSlug}/passes`)
  }

  if (!attendees.length || !products.length) return <Loader />

  return (
    <PassesProvider attendees={attendees} restoreFromCart>
      <CheckoutProvider initialStep="passes">
        <div
          className={`min-h-full w-full ${background.className}`}
          style={background.style}
        >
          <ScrollyCheckoutFlow
            onBack={handleBack}
            onPaymentComplete={() => {}}
          />
        </div>
      </CheckoutProvider>
    </PassesProvider>
  )
}
