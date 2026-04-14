import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { VenueForm } from "@/components/forms/VenueForm"
import { useWorkspace } from "@/contexts/WorkspaceContext"

export const Route = createFileRoute("/_layout/events/venues-new")({
  component: NewVenuePage,
  head: () => ({
    meta: [{ title: "New Venue - EdgeOS" }],
  }),
})

function NewVenuePage() {
  const navigate = useNavigate()
  const { selectedPopupId } = useWorkspace()

  return (
    <FormPageLayout
      title="Create Venue"
      description="Add a new venue for events"
      backTo="/events/venues"
    >
      {selectedPopupId ? (
        <VenueForm onSuccess={() => navigate({ to: "/events/venues" })} />
      ) : (
        <WorkspaceAlert resource="venue" action="create" />
      )}
    </FormPageLayout>
  )
}
