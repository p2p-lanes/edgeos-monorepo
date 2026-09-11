"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { useCityProvider } from "@/providers/cityProvider"
import LegacyBuyPassesRedirect from "./components/BuyPassesContent"

export default function BuyPassesPage() {
  const params = useParams()
  const router = useRouter()
  const { getCity } = useCityProvider()
  const city = getCity()

  // Gate access via the unified access ladder; redirect on denial.
  const access = useHumanPopupAccess(city?.id ? String(city.id) : null)

  useEffect(() => {
    if (access.state === "denied") {
      router.replace(`/portal/${params.popupSlug}`)
    }
  }, [access.state, params.popupSlug, router])

  if (access.state === "loading" || access.state === "denied") {
    return <Loader />
  }

  return <LegacyBuyPassesRedirect />
}
