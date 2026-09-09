"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { CheckoutBackgroundImage } from "@/components/CheckoutBackgroundImage"
import { CheckoutBackgroundVideo } from "@/components/CheckoutBackgroundVideo"
import ScrollyCheckoutFlow from "@/components/checkout-flow/ScrollyCheckoutFlow"
import { Loader } from "@/components/ui/Loader"
import { usePortalDirectSalesFlows } from "@/hooks/usePortalDirectSalesFlows"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { usePortalUpsaleFlows } from "@/hooks/usePortalUpsaleFlows"
import { useRequireDoor } from "@/hooks/useRequireDoor"
import { getCheckoutBackground } from "@/lib/background-image"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import PassesProvider, { usePassesProvider } from "@/providers/passesProvider"

type PortalFlow = { id: string; slug: string; type: string }

export function resolveLegacyShopRoute(
  popupSlug: string,
  flowIdentifier: string | null,
  flows: PortalFlow[],
  collectionsResolved: boolean,
) {
  if (!collectionsResolved) return null
  const flow = flows.find(
    (item) => item.id === flowIdentifier || item.slug === flowIdentifier,
  )

  if (flow?.type === "application") {
    return {
      kind: "application" as const,
      flowId: flow.id,
      flowSlug: flow.slug,
    }
  }

  return {
    kind: "shop" as const,
    target: flow
      ? `/portal/${popupSlug}/shop/${flow.slug}`
      : `/portal/${popupSlug}/shop`,
  }
}

export function ApplicationPassesCheckout({
  flowId,
  flowSlug,
}: {
  flowId: string
  flowSlug: string
}) {
  const params = useParams<{ popupSlug: string }>()
  const router = useRouter()
  const { attendeePasses: attendees, products } = usePassesProvider()
  const { getCity } = useCityProvider()
  const background = getCheckoutBackground(getCity(), "passes")
  const choosingDoor = useRequireDoor(
    getCity()?.id ? String(getCity()?.id) : null,
    String(params.popupSlug),
  )

  if (choosingDoor || !attendees.length || !products.length) return <Loader />

  return (
    <PassesProvider
      attendees={attendees}
      restoreFromCart
      flowType="application"
      salesFlowId={flowId}
    >
      <CheckoutProvider
        initialStep="passes"
        salesFlowId={flowId}
        salesFlowSlug={flowSlug}
        flowType="application"
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
            onBack={() =>
              router.push(`/portal/${params.popupSlug}/passes?flow=${flowId}`)
            }
            onPaymentComplete={() => {}}
          />
        </div>
      </CheckoutProvider>
    </PassesProvider>
  )
}

export default function BuyPassesContent() {
  const params = useParams<{ popupSlug: string }>()
  const router = useRouter()
  const flowIdentifier = useSearchParams().get("flow")
  const { getCity } = useCityProvider()
  const city = getCity()
  const popupId = city?.id ? String(city.id) : undefined
  const applicationQuery = usePortalSalesFlows(popupId)
  const directQuery = usePortalDirectSalesFlows(popupId)
  const upsaleQuery = usePortalUpsaleFlows(popupId)
  const route = resolveLegacyShopRoute(
    params.popupSlug,
    flowIdentifier,
    [
      ...(applicationQuery.data ?? []),
      ...(directQuery.data ?? []),
      ...(upsaleQuery.data ?? []),
    ],
    !applicationQuery.isLoading &&
      !directQuery.isLoading &&
      !upsaleQuery.isLoading,
  )

  useEffect(() => {
    if (route?.kind === "shop") router.replace(route.target)
  }, [route, router])

  if (route === null) return <Loader />
  if (route.kind === "application") {
    return (
      <ApplicationPassesCheckout
        flowId={route.flowId}
        flowSlug={route.flowSlug}
      />
    )
  }

  return <Loader />
}
