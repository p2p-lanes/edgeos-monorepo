import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { EventForm } from "@/components/forms/EventForm"
import { useWorkspace } from "@/contexts/WorkspaceContext"

export const Route = createFileRoute("/_layout/events/new")({
  component: NewEventPage,
  head: () => ({
    meta: [{ title: "New Event - EdgeOS" }],
  }),
})

function NewEventPage() {
  const navigate = useNavigate()
  const { selectedPopupId } = useWorkspace()

  return (
    <FormPageLayout
      title="Create Event"
      description="Add a new event to this pop-up"
      backTo="/events"
    >
      {selectedPopupId ? (
        <EventForm onSuccess={() => navigate({ to: "/events" })} />
      ) : (
        <WorkspaceAlert resource="event" action="create" />
      )}
    </FormPageLayout>
  )
}
