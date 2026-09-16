import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { PropertyForm } from "@/components/accommodations/PropertyForm"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/accommodations/properties/new")({
  component: NewPropertyPage,
  head: () => ({
    meta: [{ title: "New Property - EdgeOS" }],
  }),
})

function NewPropertyPage() {
  const navigate = useNavigate()
  const { isContextReady, selectedPopupId } = useWorkspace()
  // Back lands on the tab the operator came from, not on the calendar: the
  // section defaults to the calendar, and a fresh load without history would
  // otherwise drop them somewhere they were not.
  const goBack = useGoBack(() =>
    navigate({ to: "/accommodations", search: { tab: "properties" } }),
  )

  return (
    <FormPageLayout
      title="New property"
      description="The building or site your rooms belong to"
      backTo="/accommodations"
      onBack={goBack}
    >
      {!isContextReady || !selectedPopupId ? (
        <WorkspaceAlert resource="accommodations" />
      ) : (
        <PropertyForm popupId={selectedPopupId} onSuccess={goBack} />
      )}
    </FormPageLayout>
  )
}
