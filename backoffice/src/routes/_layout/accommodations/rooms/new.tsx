import { createFileRoute } from "@tanstack/react-router"

import { AccommodationForm } from "@/components/accommodations/AccommodationForm"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/accommodations/rooms/new")({
  component: NewRoomPage,
  head: () => ({
    meta: [{ title: "New Room - EdgeOS" }],
  }),
})

function NewRoomPage() {
  const goBack = useGoBack({ to: "/accommodations" })
  const { isContextReady, selectedPopupId } = useWorkspace()

  return (
    <FormPageLayout
      title="New room type"
      description="One card in the checkout, backed by as many units as the property has"
      backTo="/accommodations"
    >
      {!isContextReady || !selectedPopupId ? (
        <WorkspaceAlert resource="accommodations" />
      ) : (
        <AccommodationForm popupId={selectedPopupId} onSuccess={goBack} />
      )}
    </FormPageLayout>
  )
}
