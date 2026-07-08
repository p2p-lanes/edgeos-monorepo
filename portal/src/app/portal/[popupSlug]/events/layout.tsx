"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { useApplicationsQuery } from "@/hooks/useGetApplications"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { useParticipationQuery } from "@/hooks/useParticipationQuery"
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
  const { getRelevantApplication, participation } = useApplication()
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

  const isDirectSale = city?.sale_type === "direct"
  const isCompanion = participation?.type === "companion"
  const application = getRelevantApplication()

  // Only an accepted application (or an accepted companion) may view events,
  // mirroring the sidebar gate. A draft/pending_fee/in-review application owns
  // an attendee row but is not approved, so it is bounced here just as the nav
  // hides the link. Direct-sale popups don't run the application flow, so their
  // events access is left untouched. For an ended popup, eligibility instead
  // comes from `endedAccess` (useHumanPopupAccess, the backend access ladder),
  // since there's no live application/companion status to check.
  const isEligible = isEnded
    ? endedAccess.state === "allowed"
    : isCompanion
      ? participation?.application_status === "accepted"
      : application?.status === "accepted"

  const stillLoading =
    !city ||
    applicationsQuery.isLoading ||
    participationQuery.isLoading ||
    (isEnded && endedAccess.state === "loading")

  const blocked = !isDirectSale && !stillLoading && !isEligible

  useEffect(() => {
    if (blocked) {
      router.replace(`/portal/${params.popupSlug}`)
    }
  }, [blocked, params.popupSlug, router])

  if (isDirectSale) return <>{children}</>
  if (stillLoading || !isEligible) return <Loader />

  return <>{children}</>
}
