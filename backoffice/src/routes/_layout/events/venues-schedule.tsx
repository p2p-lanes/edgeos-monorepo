import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventSettingsService, EventVenuesService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Skeleton } from "@/components/ui/skeleton"
import { VenueWeekCalendar } from "@/components/VenueWeekCalendar"

export const Route = createFileRoute("/_layout/events/venues-schedule")({
  component: VenueSchedulePage,
  validateSearch: (search: Record<string, unknown>) => ({
    venueId: search.venueId as string,
  }),
  head: () => ({
    meta: [{ title: "Venue Schedule - EdgeOS" }],
  }),
})

function VenueScheduleContent({ venueId }: { venueId: string }) {
  const { data: venue } = useSuspenseQuery({
    queryKey: ["event-venues", venueId],
    queryFn: () => EventVenuesService.getVenue({ venueId }),
  })
  // Popup TZ drives all positioning. Fall back to UTC if settings aren't
  // configured — the grid still renders, just in UTC.
  const { data: settings } = useSuspenseQuery({
    queryKey: ["event-settings", venue.popup_id],
    queryFn: () =>
      EventSettingsService.getEventSettings({ popupId: venue.popup_id }),
  })
  const timezone = settings?.timezone || "UTC"

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">
          {venue.title || "Untitled venue"}
        </h2>
        {venue.location && (
          <p className="text-sm text-muted-foreground">{venue.location}</p>
        )}
      </div>
      <VenueWeekCalendar venueId={venueId} timezone={timezone} />
    </div>
  )
}

function VenueSchedulePage() {
  const { venueId } = Route.useSearch()

  return (
    <FormPageLayout
      title="Venue Schedule"
      description="Events and exceptions booked at this venue"
      backTo="/events/venues"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <VenueScheduleContent venueId={venueId} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
