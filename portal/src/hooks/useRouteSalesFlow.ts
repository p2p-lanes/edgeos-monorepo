"use client"

import { useParams, useSearchParams } from "next/navigation"
import {
  checkoutRuntimeAudience,
  useCheckoutRuntime,
} from "@/app/checkout/[popupSlug]/hooks/useCheckoutRuntime"
import { useCityProvider } from "@/providers/cityProvider"
import { useRequestLanguage } from "@/providers/requestLanguageProvider"
import useAuth from "./useAuth"
import { usePortalSalesFlows } from "./usePortalSalesFlows"

/** Read-only URL identity, shared by persistent chrome and application context. */
export function useRouteSalesFlow() {
  const params = useParams<{ popupSlug?: string; flowSlug?: string }>()
  const queryFlow = useSearchParams().get("flow")
  const { getCity } = useCityProvider()
  const city = getCity()
  const { user } = useAuth()
  const language = useRequestLanguage()
  const matchesPopup = city?.slug === params.popupSlug
  const catalog = usePortalSalesFlows(
    user && params.flowSlug && matchesPopup && city?.id
      ? String(city.id)
      : undefined,
  )
  // Observe only this route's cache entry. The page or navigation intent owns fetching.
  const { data: runtime } = useCheckoutRuntime(params.popupSlug ?? "", {
    flowSlug: params.flowSlug ?? "",
    language,
    audience: user ? checkoutRuntimeAudience(user) : undefined,
    enabled: false,
  })
  const selected =
    matchesPopup &&
    user &&
    runtime &&
    runtime.popup.slug === params.popupSlug &&
    runtime.selected_flow.slug === params.flowSlug
      ? runtime.selected_flow
      : undefined
  const knownFlow = matchesPopup
    ? catalog.data?.find(
        (flow) => flow.slug === params.flowSlug || flow.id === params.flowSlug,
      )
    : undefined
  // An unresolved named slug is deliberately non-null: it must never select a default application.
  const flowId = params.flowSlug
    ? (selected?.id ?? knownFlow?.id ?? params.flowSlug)
    : queryFlow
  return { flowId, isNamed: Boolean(params.flowSlug || queryFlow) }
}
