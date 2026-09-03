import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { NewSalesFlowWizard } from "@/components/forms/NewSalesFlowWizard"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/sales-flows/new")({
  component: NewSalesFlow,
  head: () => ({
    meta: [{ title: "New Sales Flow - EdgeOS" }],
  }),
})

function NewSalesFlow() {
  const navigate = useNavigate()
  const { isOperatorOrAbove, isUserLoading } = useAuth()
  const { selectedPopupId, isContextReady } = useWorkspace()

  // Redirect viewers to the sales flows list - they cannot create new flows
  useEffect(() => {
    if (!isUserLoading && !isOperatorOrAbove) {
      navigate({ to: "/sales-flows" })
    }
  }, [isOperatorOrAbove, isUserLoading, navigate])

  if (isUserLoading || !isOperatorOrAbove) {
    return null
  }

  return (
    <FormPageLayout
      title="New sales flow"
      description="Three questions. Everything else is configured once the flow exists."
      backTo="/sales-flows"
    >
      {!isContextReady || !selectedPopupId ? (
        <WorkspaceAlert resource="sales flow" action="create" />
      ) : (
        <NewSalesFlowWizard popupId={selectedPopupId} />
      )}
    </FormPageLayout>
  )
}
