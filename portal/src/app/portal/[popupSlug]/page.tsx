"use client"

import { useRouter } from "next/navigation"
import type { CompanionParticipation } from "@/client"
import { EventCard } from "@/components/Card/EventCard"
import type { EventStatus } from "@/components/Card/EventProgressBar"
import { CompanionView } from "@/components/CompanionView"
import { GatheringDoorCard } from "@/components/Portal/GatheringDoorCard"
import { ScholarshipStatusBadge } from "@/components/ScholarshipStatusBadge"
import { useGatheringDoors } from "@/hooks/useGatheringDoors"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"

export default function Home() {
  const { getCity } = useCityProvider()
  const { getRelevantApplication, participation } = useApplication()
  const router = useRouter()
  const city = getCity()
  const { doors } = useGatheringDoors(city?.id ? String(city.id) : null)

  if (!city) return null

  const isDirectSale = city.sale_type === "direct"

  // One relationship is unambiguous, so nothing has to be named and the
  // page stays exactly as it was. This is almost every gathering.
  const relevantApplication = getRelevantApplication()

  if (!isDirectSale && participation?.type === "companion") {
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
  if (!isDirectSale && doors.length > 1) {
    return (
      <section className="container mx-auto">
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          <EventCard popup={city} status="not_started">
            <EventCard.Image />
            <EventCard.Content>
              <EventCard.Title />
              <EventCard.Tagline />
              <EventCard.Location />
              <EventCard.DateRange />
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

  const status: EventStatus = isDirectSale
    ? "not_started"
    : ((relevantApplication?.status as EventStatus) ?? "not_started")

  const onClickApply = () => {
    if (isDirectSale) {
      router.push(`/checkout/${city.slug}`)
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
        <EventCard popup={city} status={status}>
          <EventCard.Image />
          <EventCard.Content>
            <EventCard.Title />
            <EventCard.Tagline />
            <EventCard.Location />
            <EventCard.DateRange />
            {!isDirectSale && <EventCard.Progress />}
            {!isDirectSale && relevantApplication && (
              <ScholarshipStatusBadge
                application={relevantApplication}
                popup={city}
              />
            )}
            {city.status !== "ended" && (
              <EventCard.ApplyButton
                onClick={onClickApply}
                labelKey={isDirectSale ? "cta.buy_tickets" : undefined}
              />
            )}
          </EventCard.Content>
        </EventCard>
      </div>
    </section>
  )
}
