"use client"

import { useRouter } from "next/navigation"
import type { CompanionParticipation } from "@/client"
import { EventCard } from "@/components/Card/EventCard"
import type { EventStatus } from "@/components/Card/EventProgressBar"
import { CompanionView } from "@/components/CompanionView"
import { ScholarshipStatusBadge } from "@/components/ScholarshipStatusBadge"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"

export default function Home() {
  const { getCity } = useCityProvider()
  const { getRelevantApplication, participation } = useApplication()
  const router = useRouter()
  const city = getCity()
  const relevantApplication = getRelevantApplication()

  if (!city) return null

  if (participation?.type === "companion") {
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

  const status = (relevantApplication?.status as EventStatus) ?? "not_started"

  const onClickApply = () => {
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
            <EventCard.Progress />
            {relevantApplication && (
              <ScholarshipStatusBadge
                application={relevantApplication}
                popup={city}
              />
            )}
            <EventCard.ApplyButton onClick={onClickApply} />
          </EventCard.Content>
        </EventCard>
      </div>
    </section>
  )
}
