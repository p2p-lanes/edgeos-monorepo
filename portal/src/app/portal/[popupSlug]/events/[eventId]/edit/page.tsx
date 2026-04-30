"use client"

import { useQuery } from "@tanstack/react-query"
import { Image as ImageIcon, Loader2 } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useTranslation } from "react-i18next"

import { EventsService, HumansService } from "@/client"
import { useCityProvider } from "@/providers/cityProvider"
import { EditEventForm } from "./EditEventForm"

export default function EditPortalEventPage() {
  const { t } = useTranslation()
  const params = useParams<{ popupSlug: string; eventId: string }>()
  const { getCity } = useCityProvider()
  const city = getCity()

  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ["portal-event", params.eventId],
    queryFn: () => EventsService.getPortalEvent({ eventId: params.eventId }),
    enabled: !!params.eventId,
  })

  const { data: currentHuman, isLoading: humanLoading } = useQuery({
    queryKey: ["current-human"],
    queryFn: () => HumansService.getCurrentHumanInfo(),
    staleTime: 5 * 60 * 1000,
  })

  if (eventLoading || humanLoading || !city?.id) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (!event) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 text-center py-20">
        <ImageIcon className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">
          {t("events.detail.event_not_found")}
        </p>
      </div>
    )
  }

  if (!currentHuman || event.owner_id !== currentHuman.id) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 text-center py-20">
        <h1 className="text-xl font-semibold">
          {t("events.form.not_your_event_heading")}
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          {t("events.form.not_your_event_message")}
        </p>
        <Link
          href={`/portal/${city.slug}/events/${params.eventId}`}
          className="mt-4 inline-block text-sm underline"
        >
          {t("events.form.back_to_event")}
        </Link>
      </div>
    )
  }

  return (
    <EditEventForm
      key={event.id}
      event={event}
      popupId={city.id}
      citySlug={city.slug ?? params.popupSlug}
      cityName={city.name ?? ""}
      cityStartDate={city.start_date}
      cityEndDate={city.end_date}
    />
  )
}
