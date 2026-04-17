import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { EventForm } from "@/components/forms/EventForm"
import { useWorkspace } from "@/contexts/WorkspaceContext"

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
  const navigate = useNavigate()
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
          onSuccess={() => navigate({ to: "/events" })}
        />
      ) : (
        <WorkspaceAlert resource="event" action="create" />
      )}
    </FormPageLayout>
  )
}
