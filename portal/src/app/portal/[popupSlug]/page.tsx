"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import type { CompanionParticipation } from "@/client"
import { EventCard } from "@/components/Card/EventCard"
import type { EventStatus } from "@/components/Card/EventProgressBar"
import { CompanionView } from "@/components/CompanionView"
import { ScholarshipStatusBadge } from "@/components/ScholarshipStatusBadge"
import { useHumanAttendeesQuery } from "@/hooks/useHumanAttendeesQuery"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"

export default function Home() {
  const { getCity } = useCityProvider()
  const { getRelevantApplication, participation } = useApplication()
  const router = useRouter()
  const city = getCity()
  const relevantApplication = getRelevantApplication()

  // Application-flow ticket holders skip their application card and land
  // straight on the events list. Direct-sale and companion flows keep their
  // own landing views, and we only redirect when the events module is on.
  const attendeesQuery = useHumanAttendeesQuery(city?.id)
  const isDirectSale = city?.sale_type === "direct"
  const isCompanion = participation?.type === "companion"
  const eventsEnabled = city?.events_enabled ?? true
  const shouldRedirectToEvents =
    !!city &&
    !isDirectSale &&
    !isCompanion &&
    eventsEnabled &&
    (attendeesQuery.data?.length ?? 0) > 0

  const slug = city?.slug
  useEffect(() => {
    if (shouldRedirectToEvents && slug) {
      router.replace(`/portal/${slug}/events`)
    }
  }, [shouldRedirectToEvents, slug, router])

  if (!city) return null

  // Wait for the attendees query before rendering the application card so a
  // ticket holder never sees it flash before the redirect fires.
  if (!isDirectSale && !isCompanion) {
    if (attendeesQuery.isLoading || shouldRedirectToEvents) return null
  }

  if (!isDirectSale && isCompanion) {
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
            <EventCard.ApplyButton
              onClick={onClickApply}
              labelKey={isDirectSale ? "cta.buy_tickets" : undefined}
            />
          </EventCard.Content>
        </EventCard>
      </div>
    </section>
  )
}
