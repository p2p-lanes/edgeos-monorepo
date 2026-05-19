"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { CheckoutBackgroundVideo } from "@/components/CheckoutBackgroundVideo"
import ScrollyCheckoutFlow from "@/components/checkout-flow/ScrollyCheckoutFlow"
import { Loader } from "@/components/ui/Loader"
import { getCheckoutBackground } from "@/lib/background-image"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import PassesProvider, { usePassesProvider } from "@/providers/passesProvider"

export default function BuyPassesContent() {
  const params = useParams()
  const router = useRouter()
  const { attendeePasses: attendees, products } = usePassesProvider()
  const { getCity } = useCityProvider()
  const background = getCheckoutBackground(getCity(), "passes")

  // The portal layout owns the scroll container (<main id="portal-scroll">),
  // and the SnapDotNav indicator sits on the right edge of the viewport. The
  // native scrollbar overlaps it, so hide the scrollbar only while this view
  // is mounted.
  useEffect(() => {
    const main = document.getElementById("portal-scroll")
    main?.classList.add("no-scrollbar")
    return () => {
      main?.classList.remove("no-scrollbar")
    }
  }, [])

  const handleBack = () => {
    router.push(`/portal/${params.popupSlug}/passes`)
  }

  if (!attendees.length || !products.length) return <Loader />

  return (
    <PassesProvider attendees={attendees} restoreFromCart>
      <CheckoutProvider initialStep="passes">
        {background.type === "video" && (
          <CheckoutBackgroundVideo url={background.url} />
        )}
        <div
          className={`min-h-full w-full ${background.type === "none" ? "bg-background" : ""}`.trim()}
          style={background.type === "image" ? background.style : undefined}
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
