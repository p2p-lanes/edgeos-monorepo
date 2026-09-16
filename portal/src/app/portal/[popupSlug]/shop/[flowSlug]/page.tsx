"use client"

import { useParams, useSearchParams } from "next/navigation"
import { Loader } from "@/components/ui/Loader"
import { useCityProvider } from "@/providers/cityProvider"
import { ShopCheckoutContent } from "./ShopCheckoutContent"

export default function ShopFlowPage() {
  const params = useParams<{ popupSlug: string; flowSlug: string }>()
  const searchParams = useSearchParams()
  const { getCity } = useCityProvider()
  const city = getCity()

  if (!city) return <Loader />

  return (
    <ShopCheckoutContent
      popupId={String(city.id)}
      popupSlug={String(params.popupSlug)}
      flowSlug={String(params.flowSlug)}
      returnContext={
        searchParams.get("return_context") === "direct" ? "direct" : "portal"
      }
    />
  )
}
