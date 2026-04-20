"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { resolvePopupCheckoutPolicy } from "@/checkout/popupCheckoutPolicy"
import { Loader } from "@/components/ui/Loader"
import { useCityProvider } from "@/providers/cityProvider"
import usePermission from "../hooks/usePermission"
import BuyPassesContent from "./components/BuyPassesContent"

export default function BuyPassesPage() {
  usePermission()

  const router = useRouter()
  const { getCity } = useCityProvider()
  const city = getCity()
  const policy = resolvePopupCheckoutPolicy(city)

  useEffect(() => {
    if (policy.saleType === "direct" && city?.slug) {
      router.replace(`/portal/${city.slug}`)
    }
  }, [policy.saleType, city?.slug, router])

  if (policy.saleType === "direct") {
    return <Loader />
  }

  return <BuyPassesContent />
}
