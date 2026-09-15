"use client"

import { PopupHomeFrame } from "@edgeos/shared-form-ui/popup-home"
import { useQuery } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import type { ApplicationPublic, PopupPublic } from "@/client"
import { ApiError, PopupsService } from "@/client"
import DefaultPopupHome from "@/components/Portal/DefaultPopupHome"
import { Loader } from "@/components/ui/Loader"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { useFeePaymentConfirmation } from "./application/components/fee-payment-banner"

function FeePaymentConfirmationEffects({
  application,
}: {
  application: ApplicationPublic
}) {
  useFeePaymentConfirmation(application, true)
  return null
}

function CustomPopupHome({ city }: { city: PopupPublic }) {
  const { i18n } = useTranslation()
  const searchParams = useSearchParams()
  const { getRelevantApplication } = useApplication()
  const feeFlowId = searchParams.has("checkout", "success")
    ? searchParams.get("flow")
    : null
  const feeApplication = feeFlowId ? getRelevantApplication(feeFlowId) : null
  const { data: home, isPending } = useQuery({
    queryKey: ["popup-home", city.id],
    queryFn: () => PopupsService.getPortalPopupHome({ slug: city.slug }),
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 404) && failureCount < 1,
    staleTime: 60_000,
  })

  if (isPending) return <Loader />
  // The list signal and resource can briefly disagree while caches refresh.
  // A missing/failed document must never leave the gathering without a home.
  if (!home?.html.trim()) return <DefaultPopupHome />

  return (
    <>
      {feeApplication && (
        <FeePaymentConfirmationEffects
          key={feeApplication.id}
          application={feeApplication}
        />
      )}
      <PopupHomeFrame
        key={city.id}
        html={home.html}
        popup={city}
        locale={i18n.resolvedLanguage ?? city.default_language ?? "en"}
        title={city.name}
        className="block h-full min-h-[480px] w-full border-0 bg-white"
      />
    </>
  )
}

export default function Home() {
  const { getCity, popupsLoaded } = useCityProvider()
  const city = getCity()
  const router = useRouter()

  useEffect(() => {
    if (popupsLoaded && !city) router.replace("/portal")
  }, [city, popupsLoaded, router])

  if (!city) return popupsLoaded ? null : <Loader />
  if (!city.custom_home_enabled) return <DefaultPopupHome />
  return <CustomPopupHome key={city.id} city={city} />
}
