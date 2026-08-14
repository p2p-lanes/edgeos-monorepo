"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { CheckoutBackgroundImage } from "@/components/CheckoutBackgroundImage"
import { CheckoutBackgroundVideo } from "@/components/CheckoutBackgroundVideo"
import ScrollyCheckoutFlow from "@/components/checkout-flow/ScrollyCheckoutFlow"
import { Loader } from "@/components/ui/Loader"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { usePortalUpsaleFlows } from "@/hooks/usePortalUpsaleFlows"
import { useRequireDoor } from "@/hooks/useRequireDoor"
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
  // Which kind of door this is. Both listings are already cached by the pages
  // that brought the buyer here, so this costs no extra request — and an
  // upsale sells like a shop while an application door sells passes one per
  // attendee (sdd/sales-flows-rediseno slice 6).
  const popupIdForFlows = getCity()?.id ? String(getCity()?.id) : undefined
  const { data: applicationFlows } = usePortalSalesFlows(popupIdForFlows)
  const { data: upsaleFlows } = usePortalUpsaleFlows(popupIdForFlows)
  const flowType =
    [...(applicationFlows ?? []), ...(upsaleFlows ?? [])].find(
      (flow) => flow.id === flowId,
    )?.type ?? null
  // Same rule as the passes list: this checkout sells into one
  // application, so it will not open without knowing which.
  const choosingDoor = useRequireDoor(
    getCity()?.id ? String(getCity()?.id) : null,
    String(params.popupSlug),
  )

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

  if (choosingDoor || !attendees.length || !products.length) return <Loader />

  return (
    <PassesProvider attendees={attendees} restoreFromCart>
      <CheckoutProvider
        initialStep="passes"
        salesFlowId={flowId}
        flowType={flowType}
      >
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
