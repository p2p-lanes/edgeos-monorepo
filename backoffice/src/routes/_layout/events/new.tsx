import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { EventForm } from "@/components/forms/EventForm"

export const Route = createFileRoute("/_layout/events/new")({
  component: NewEventPage,
  head: () => ({
    meta: [{ title: "New Event - EdgeOS" }],
  }),
})

function NewEventPage() {
  const navigate = useNavigate()

  return (
    <FormPageLayout
      title="Create Event"
      description="Add a new event to this pop-up"
      backTo="/events"
    >
      <EventForm onSuccess={() => navigate({ to: "/events" })} />
    </FormPageLayout>
  )
}
