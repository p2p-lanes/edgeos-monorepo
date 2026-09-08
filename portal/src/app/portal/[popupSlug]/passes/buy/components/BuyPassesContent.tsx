"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { usePortalDirectSalesFlows } from "@/hooks/usePortalDirectSalesFlows"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { usePortalUpsaleFlows } from "@/hooks/usePortalUpsaleFlows"
import { canonicalShopTarget } from "@/lib/shop-route"
import { useCityProvider } from "@/providers/cityProvider"

export { ApplicationPassesCheckout } from "@/components/checkout-flow/ApplicationPassesCheckout"

type PortalFlow = { id: string; slug: string; type: string }

export function resolveLegacyShopRoute(
  popupSlug: string,
  flowIdentifier: string | null,
  flows: PortalFlow[],
  collectionsResolved: boolean,
  search = "",
  hash = "",
) {
  if (!collectionsResolved) return null
  const flow = flows.find(
    (item) => item.id === flowIdentifier || item.slug === flowIdentifier,
  )
  return {
    kind: "shop" as const,
    target: canonicalShopTarget(popupSlug, flow?.slug ?? null, search, hash),
  }
}

export default function BuyPassesContent() {
  const { popupSlug } = useParams<{ popupSlug: string }>()
  const router = useRouter()
  const search = useSearchParams().toString()
  const flowIdentifier = new URLSearchParams(search).get("flow")
  const { getCity } = useCityProvider()
  const city = getCity()
  const popupId = city?.id ? String(city.id) : undefined
  const application = usePortalSalesFlows(popupId)
  const direct = usePortalDirectSalesFlows(popupId)
  const upsale = usePortalUpsaleFlows(popupId)
  const route = resolveLegacyShopRoute(
    popupSlug,
    flowIdentifier,
    [
      ...(application.data ?? []),
      ...(direct.data ?? []),
      ...(upsale.data ?? []),
    ],
    Boolean(popupId) &&
      !application.isLoading &&
      !direct.isLoading &&
      !upsale.isLoading,
    search,
  )
  const target = route?.target

  useEffect(() => {
    if (target) router.replace(`${target}${window.location.hash}`)
  }, [target, router])

  return <Loader />
}
