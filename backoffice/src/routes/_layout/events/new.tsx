import { createFileRoute } from "@tanstack/react-router"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { EventForm } from "@/components/forms/EventForm"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import { useGoBack } from "@/hooks/useGoBack"

interface NewEventSearch {
  venueId?: string
  startTime?: string
}

export const Route = createFileRoute("/_layout/events/new")({
  component: NewEventPage,
  head: () => ({
    meta: [{ title: "New Event - EdgeOS" }],
  }),
  validateSearch: (search: Record<string, unknown>): NewEventSearch => ({
    venueId: typeof search.venueId === "string" ? search.venueId : undefined,
    startTime:
      typeof search.startTime === "string" ? search.startTime : undefined,
  }),
})

function NewEventPage() {
  const goBack = useGoBack({ to: "/events" })
  const { selectedPopupId } = useWorkspace()
  const { venueId, startTime } = Route.useSearch()

  return (
    <FormPageLayout
      title="Create Event"
      description="Add a new event to this pop-up"
      backTo="/events"
    >
      {selectedPopupId ? (
        <EventForm
          initialVenueId={venueId}
          initialStartIso={startTime}
          onSuccess={goBack}
        />
      ) : (
        <WorkspaceAlert resource="event" action="create" />
      )}
    </FormPageLayout>
  )
}
