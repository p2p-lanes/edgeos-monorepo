import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventsService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { EventForm } from "@/components/forms/EventForm"
import { Skeleton } from "@/components/ui/skeleton"

export const Route = createFileRoute("/_layout/events/$eventId/edit")({
  component: EditEventPage,
  head: () => ({
    meta: [{ title: "Edit Event - EdgeOS" }],
  }),
})

function EditEventContent({ eventId }: { eventId: string }) {
  const navigate = useNavigate()
  const { data: event } = useSuspenseQuery({
    queryKey: ["events", eventId],
    queryFn: () => EventsService.getEvent({ eventId }),
  })

  return (
    <EventForm
      defaultValues={event}
      onSuccess={() => navigate({ to: "/events" })}
    />
  )
}

function EditEventPage() {
  const { eventId } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Event"
      description="Update event details"
      backTo="/events"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditEventContent eventId={eventId} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
