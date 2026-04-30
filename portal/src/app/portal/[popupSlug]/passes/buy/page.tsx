"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { resolvePopupCheckoutPolicy } from "@/checkout/popupCheckoutPolicy"
import { Loader } from "@/components/ui/Loader"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { useCityProvider } from "@/providers/cityProvider"
import BuyPassesContent from "./components/BuyPassesContent"

export default function BuyPassesPage() {
  const params = useParams()
  const router = useRouter()
  const { getCity } = useCityProvider()
  const city = getCity()
  const policy = resolvePopupCheckoutPolicy(city)

  // Gate access via the unified access ladder; redirect on denial.
  const access = useHumanPopupAccess(city?.id ? String(city.id) : null)

  useEffect(() => {
    if (access.state === "denied") {
      router.replace(`/portal/${params.popupSlug}`)
      return
    }
    if (policy.saleType === "direct" && city?.slug) {
      router.replace(`/portal/${city.slug}`)
    }
  }, [access.state, params.popupSlug, policy.saleType, city?.slug, router])

  if (access.state === "loading" || access.state === "denied") {
    return <Loader />
  }

  if (policy.saleType === "direct") {
    return <Loader />
  }

  return <BuyPassesContent />
}
