"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { CheckoutBackgroundImage } from "@/components/CheckoutBackgroundImage"
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
  const searchParams = useSearchParams()
  const { attendeePasses: attendees, products } = usePassesProvider()
  const { getCity } = useCityProvider()
  const background = getCheckoutBackground(getCity(), "passes")

  // Which door into the gathering this purchase is for. Steps belong to a
  // sales flow (sdd/sales-flows-rediseno), so without it someone accepted
  // through a partner door bought through the default door's checkout —
  // its steps, its products, its wording. Absent means the gathering has
  // one door, which is almost all of them.
  const flowId = searchParams.get("flow")

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
    // Carry the door back, or the passes list starts guessing again.
    const back = `/portal/${params.popupSlug}/passes`
    router.push(flowId ? `${back}?flow=${flowId}` : back)
  }

  if (!attendees.length || !products.length) return <Loader />

  return (
    <PassesProvider attendees={attendees} restoreFromCart>
      <CheckoutProvider initialStep="passes" salesFlowId={flowId}>
        {background.type === "image" && (
          <CheckoutBackgroundImage url={background.url} />
        )}
        {background.type === "video" && (
          <CheckoutBackgroundVideo url={background.url} />
        )}
        <div
          className={`min-h-full w-full ${background.type === "none" ? "bg-background" : ""}`.trim()}
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
