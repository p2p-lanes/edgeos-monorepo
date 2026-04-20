"use client"

import { useParams, useRouter } from "next/navigation"
import ScrollyCheckoutFlow from "@/components/checkout-flow/ScrollyCheckoutFlow"
import { Loader } from "@/components/ui/Loader"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import PassesProvider, { usePassesProvider } from "@/providers/passesProvider"

export default function BuyPassesContent() {
  const params = useParams()
  const router = useRouter()
  const { attendeePasses: attendees, products } = usePassesProvider()

  const handleBack = () => {
    router.push(`/portal/${params.popupSlug}/passes`)
  }

  if (!attendees.length || !products.length) return <Loader />

  return (
    <PassesProvider attendees={attendees} restoreFromCart>
      <CheckoutProvider initialStep="passes">
        <ScrollyCheckoutFlow
          onBack={handleBack}
          onPaymentComplete={() => {}}
        />
      </CheckoutProvider>
    </PassesProvider>
  )
}
