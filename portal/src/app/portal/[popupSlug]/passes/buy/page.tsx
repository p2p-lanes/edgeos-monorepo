"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { useCityProvider } from "@/providers/cityProvider"
import BuyPassesContent from "./components/BuyPassesContent"

export default function BuyPassesPage() {
  const params = useParams()
  const router = useRouter()
  const { getCity } = useCityProvider()
  const city = getCity()
  const isDirectSale = city?.sale_type === "direct"

  // Gate access via the unified access ladder; redirect on denial.
  const access = useHumanPopupAccess(city?.id ? String(city.id) : null)

  useEffect(() => {
    // Direct-sale popups own their checkout flow at /checkout/[slug]; this
    // route is application-only. Forward direct-sale buyers to the canonical
    // anonymous flow (which prefills buyer info when authed).
    if (isDirectSale) {
      router.replace(`/checkout/${params.popupSlug}`)
      return
    }
    if (access.state === "denied") {
      router.replace(`/portal/${params.popupSlug}`)
    }
  }, [access.state, isDirectSale, params.popupSlug, router])

  if (isDirectSale || access.state === "loading" || access.state === "denied") {
    return <Loader />
  }

  return <BuyPassesContent />
}
