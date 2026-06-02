import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { CalendarRange } from "lucide-react"
import { Suspense } from "react"

import { EventVenuesService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { VenueForm } from "@/components/forms/VenueForm"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/events/venues/$venueId/edit")({
  component: EditVenuePage,
  head: () => ({
    meta: [{ title: "Edit Venue - EdgeOS" }],
  }),
})

function EditVenueContent({ venueId }: { venueId: string }) {
  const goBack = useGoBack({ to: "/events/venues" })
  const { data: venue } = useSuspenseQuery({
    queryKey: ["event-venues", venueId],
    queryFn: () => EventVenuesService.getVenue({ venueId }),
  })

  return <VenueForm defaultValues={venue} onSuccess={goBack} />
}

function EditVenuePage() {
  const { venueId } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Venue"
      description="Update venue details"
      backTo="/events/venues"
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/events/venues/$venueId/schedule" params={{ venueId }}>
            <CalendarRange className="mr-2 h-4 w-4" />
            Schedule
          </Link>
        </Button>
      }
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditVenueContent venueId={venueId} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
