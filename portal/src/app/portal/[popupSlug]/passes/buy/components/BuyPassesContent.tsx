"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { usePortalDirectSalesFlows } from "@/hooks/usePortalDirectSalesFlows"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { usePortalUpsaleFlows } from "@/hooks/usePortalUpsaleFlows"
import { useCityProvider } from "@/providers/cityProvider"

type PortalFlow = { id: string; slug: string }

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

  return {
    kind: "shop" as const,
    target: flow
      ? `/portal/${popupSlug}/shop/${flow.slug}`
      : `/portal/${popupSlug}`,
  }
}

/** Redirects legacy `?flow=` links to the canonical authenticated Shop route. */
export default function LegacyBuyPassesRedirect() {
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
    if (route) router.replace(route.target)
  }, [route, router])

  return <Loader />
}
