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

  // Subscribe to the same queries the sidebar reads so this route gate matches
  // nav visibility exactly (see useResources `canSeeAttendees`). For a live
  // popup this means getRelevantApplication (not-ended path below); for an
  // ended popup it means useHumanPopupAccess, the backend access ladder, via
  // `endedAccess`. Either way this stays in lockstep with the popup root
  // redirect, so the two can never disagree and bounce the user back and
  // forth.
  const applicationsQuery = useApplicationsQuery()
  const participationQuery = useParticipationQuery(popupId)

  const nobodyApplies = city?.takes_applications === false
  // Events are popup-wide, not owned by one application flow. Any accepted
  // application for this popup (or accepted companion participation) grants
  // access, even when a shared/direct URL has no `flow` query parameter.
  // Direct-sale popups don't run the application flow, so their events access
  // is left untouched. Ended-popup eligibility comes from the backend ladder.
  const isEligible = isEnded
    ? endedAccess.state === "allowed"
    : hasAcceptedPopupParticipation(getApplicationsForPopup(), participation)

  const stillLoading =
    !city ||
    applicationsQuery.isLoading ||
    participationQuery.isLoading ||
    (isEnded && endedAccess.state === "loading")

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
