import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventVenuesService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { VenueForm } from "@/components/forms/VenueForm"
import { Skeleton } from "@/components/ui/skeleton"

export const Route = createFileRoute("/_layout/events/venues/$venueId/edit")({
  component: EditVenuePage,
  head: () => ({
    meta: [{ title: "Edit Venue - EdgeOS" }],
  }),
})

function EditVenueContent({ venueId }: { venueId: string }) {
  const navigate = useNavigate()
  const { data: venue } = useSuspenseQuery({
    queryKey: ["event-venues", venueId],
    queryFn: () => EventVenuesService.getVenue({ venueId }),
  })

  return (
    <VenueForm
      defaultValues={venue}
      onSuccess={() => navigate({ to: "/events/venues" })}
    />
  )
}

function EditVenuePage() {
  const { venueId } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Venue"
      description="Update venue details"
      backTo="/events/venues"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditVenueContent venueId={venueId} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
