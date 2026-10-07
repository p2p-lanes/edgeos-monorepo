"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { useApplicationsQuery } from "@/hooks/useGetApplications"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { useParticipationQuery } from "@/hooks/useParticipationQuery"
import { hasAcceptedPopupParticipation } from "@/lib/popup-participation"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"

export default function EventsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const params = useParams()
  const router = useRouter()
  const { getCity } = useCityProvider()
  const { getApplicationsForPopup, participation } = useApplication()
  const city = getCity()
  const popupId = city?.id ? String(city.id) : null
  const isEnded = city?.status === "ended"
  const endedAccess = useHumanPopupAccess(isEnded ? popupId : null)

  // Keep the route gate aligned with sidebar visibility. The backend access
  // ladder grants access to active ticket holders even when a ticket was
  // granted without creating an accepted application.
  const applicationsQuery = useApplicationsQuery()
  const participationQuery = useParticipationQuery(popupId)
  const popupAccess = useHumanPopupAccess(popupId)

  const nobodyApplies = city?.takes_applications === false
  // Events are popup-wide, not owned by one application flow. Any accepted
  // application for this popup (or accepted companion participation) grants
  // access, even when a shared/direct URL has no `flow` query parameter.
  // Direct-sale popups don't run the application flow, so their events access
  // and ticket grants are resolved by the backend access ladder.
  const isEligible = isEnded
    ? endedAccess.state === "allowed"
    : popupAccess.state === "allowed" ||
      hasAcceptedPopupParticipation(getApplicationsForPopup(), participation)

  const stillLoading =
    !city ||
    applicationsQuery.isLoading ||
    participationQuery.isLoading ||
    (isEnded && endedAccess.state === "loading") ||
    (!isEnded && !nobodyApplies && popupAccess.state === "loading")

  const blocked = !nobodyApplies && !stillLoading && !isEligible

  useEffect(() => {
    if (blocked) {
      router.replace(`/portal/${params.popupSlug}`)
    }
  }, [blocked, params.popupSlug, router])

  if (nobodyApplies) return <>{children}</>
  if (stillLoading || !isEligible) return <Loader />

  return <>{children}</>
}
