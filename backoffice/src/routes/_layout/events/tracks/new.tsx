import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { TrackForm } from "@/components/forms/TrackForm"
import { useWorkspace } from "@/contexts/WorkspaceContext"

export const Route = createFileRoute("/_layout/events/tracks/new")({
  component: NewTrackPage,
  head: () => ({
    meta: [{ title: "New Track - EdgeOS" }],
  }),
})

function NewTrackPage() {
  const navigate = useNavigate()
  const { selectedPopupId } = useWorkspace()

  return (
    <FormPageLayout
      title="Create Track"
      description="Add a new track to group related events"
      backTo="/events/tracks"
    >
      {selectedPopupId ? (
        <TrackForm
          onSuccess={(track) =>
            navigate({
              to: "/events/tracks/$trackId/edit",
              params: { trackId: track.id },
            })
          }
        />
      ) : (
        <WorkspaceAlert resource="track" action="create" />
      )}
    </FormPageLayout>
  )
}
