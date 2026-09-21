"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { FeePaymentBanner } from "@/app/portal/[popupSlug]/application/components/fee-payment-banner"
import type { CompanionParticipation } from "@/client"
import { EventCard } from "@/components/Card/EventCard"
import type { EventStatus } from "@/components/Card/EventProgressBar"
import { CompanionView } from "@/components/CompanionView"
import { ApplicationUnavailable } from "@/components/Portal/ApplicationUnavailable"
import { GatheringDoorCard } from "@/components/Portal/GatheringDoorCard"
import { ScholarshipStatusBadge } from "@/components/ScholarshipStatusBadge"
import { Loader } from "@/components/ui/Loader"
import { useGatheringDoors } from "@/hooks/useGatheringDoors"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { usePortalDirectSalesFlows } from "@/hooks/usePortalDirectSalesFlows"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"

export default function DefaultPopupHome() {
  const { getCity, popupsLoaded } = useCityProvider()
  const { getRelevantApplication, participation } = useApplication()
  const router = useRouter()
  const searchParams = useSearchParams()
  const feeFlowId = searchParams.has("checkout", "success")
    ? searchParams.get("flow")
    : null
  const city = getCity()
  const access = useHumanPopupAccess(city?.id)
  const hasAssignedTickets =
    access.state === "allowed" && access.source === "attendee"
  const {
    doors,
    isLoading: doorsLoading,
    isError: doorsError,
  } = useGatheringDoors(city?.id ? String(city.id) : null)
  const directFlowsQuery = usePortalDirectSalesFlows(
    city?.takes_applications === false && city.id ? String(city.id) : undefined,
  )

  useEffect(() => {
    if (popupsLoaded && !city) router.replace("/portal")
  }, [city, popupsLoaded, router])

  if (!city) return popupsLoaded ? null : <Loader />

  const nobodyApplies = city?.takes_applications === false
  const listedDirectFlow = directFlowsQuery.data?.[0]

  if (!nobodyApplies && !hasAssignedTickets && doorsLoading) return <Loader />
  if (!nobodyApplies && !hasAssignedTickets && doorsError)
    return <ApplicationUnavailable />

  // One relationship is unambiguous, so nothing has to be named and the
  // page stays exactly as it was. This is almost every gathering.
  const relevantApplication = getRelevantApplication()
  // Only poll the application named by the fee return. A buyer can have
  // multiple applications here; never confirm whichever happens to be first.
  const feeApplication = feeFlowId ? getRelevantApplication(feeFlowId) : null
  const feeBanner =
    !nobodyApplies && feeApplication ? (
      <FeePaymentBanner
        key={feeApplication.id}
        application={feeApplication}
        isReturnFromCheckout
      />
    ) : null

  if (!nobodyApplies && participation?.type === "companion") {
    return (
      <section className="container mx-auto">
        <div className="space-y-6 max-w-5xl p-6 mx-auto">
          <CompanionView
            participation={participation as CompanionParticipation}
          />
        </div>
      </section>
    )
  }

  // More than one way in, and the page cannot speak for all of them at
  // once: a volunteer accepted and a general application in review are two
  // states, two sets of attendees and two different next steps. Drawing
  // them side by side is also the only place a person can find out they
  // hold both (sdd/sales-flows-rediseno).
  if (!nobodyApplies && doors.length > 1) {
    return (
      <section className="container mx-auto">
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          {feeBanner}
          <EventCard popup={city} status="not_started">
            <EventCard.Image />
            <EventCard.Content>
              <EventCard.Title />
              <EventCard.Tagline />
              <EventCard.Location />
              <EventCard.DateRange />
              {hasAssignedTickets && (
                <EventCard.ApplyButton
                  onClick={() => router.push(`/portal/${city.slug}/passes`)}
                  labelKey="cta.accepted"
                />
              )}
            </EventCard.Content>
          </EventCard>
          <div className="grid gap-4 sm:grid-cols-2">
            {doors.map((door) => (
              <GatheringDoorCard
                key={door.flowId}
                door={door}
                popupSlug={city.slug}
                showName
              />
            ))}
          </div>
        </div>
      </section>
    )
  }

  const status: EventStatus = nobodyApplies
    ? "not_started"
    : ((relevantApplication?.status as EventStatus) ?? "not_started")

  const onClickApply = () => {
    if (hasAssignedTickets) {
      router.push(`/portal/${city.slug}/passes`)
      return
    }
    if (nobodyApplies) {
      if (listedDirectFlow) {
        router.push(`/checkout/${city.slug}/${listedDirectFlow.slug}`)
      }
      return
    }
    if (status === "accepted") {
      router.push(`/portal/${city.slug}/passes`)
      return
    }
    router.push(`/portal/${city.slug}/application`)
  }

  return (
    <section className="container mx-auto">
      <div className="space-y-6 max-w-5xl p-6 mx-auto">
        {feeBanner}
        <EventCard popup={city} status={status}>
          <EventCard.Image />
          <EventCard.Content>
            <EventCard.Title />
            <EventCard.Tagline />
            <EventCard.Location />
            <EventCard.DateRange />
            {!nobodyApplies && (!hasAssignedTickets || relevantApplication) && (
              <EventCard.Progress />
            )}
            {!nobodyApplies && relevantApplication && (
              <ScholarshipStatusBadge
                application={relevantApplication}
                popup={city}
              />
            )}
            {(hasAssignedTickets ||
              (city.status !== "ended" &&
                (!nobodyApplies || listedDirectFlow))) && (
              <EventCard.ApplyButton
                onClick={onClickApply}
                labelKey={
                  hasAssignedTickets
                    ? "cta.accepted"
                    : nobodyApplies
                      ? "cta.buy_tickets"
                      : undefined
                }
              />
            )}
          </EventCard.Content>
        </EventCard>
      </div>
    </section>
  )
}
