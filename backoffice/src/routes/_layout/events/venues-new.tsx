import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { VenueForm } from "@/components/forms/VenueForm"

export const Route = createFileRoute("/_layout/events/venues-new")({
  component: NewVenuePage,
  head: () => ({
    meta: [{ title: "New Venue - EdgeOS" }],
  }),
})

function NewVenuePage() {
  const navigate = useNavigate()

  return (
    <FormPageLayout
      title="Create Venue"
      description="Add a new venue for events"
      backTo="/events/venues"
    >
      <VenueForm onSuccess={() => navigate({ to: "/events/venues" })} />
    </FormPageLayout>
  )
}
