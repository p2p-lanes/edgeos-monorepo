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
  const nobodyApplies = city?.takes_applications === false

  // Gate access via the unified access ladder; redirect on denial.
  const access = useHumanPopupAccess(city?.id ? String(city.id) : null)

  useEffect(() => {
    // Direct-sale popups own their checkout flow at /checkout/[slug]/checkout; this
    // route is application-only. Forward direct-sale buyers to the canonical
    // anonymous flow (which prefills buyer info when authed).
    if (nobodyApplies) {
      router.replace(`/checkout/${params.popupSlug}/checkout`)
      return
    }
    if (access.state === "denied") {
      router.replace(`/portal/${params.popupSlug}`)
    }
  }, [access.state, nobodyApplies, params.popupSlug, router])

  if (
    nobodyApplies ||
    access.state === "loading" ||
    access.state === "denied"
  ) {
    return <Loader />
  }

  return <BuyPassesContent />
}
