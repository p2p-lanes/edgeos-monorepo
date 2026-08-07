import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { NewSalesFlowForm } from "@/components/forms/NewSalesFlowForm"
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
      title="Create Sales Flow"
      description="Name it and pick where it starts from. Everything else is configured afterwards."
      backTo="/sales-flows"
    >
      {!isContextReady || !selectedPopupId ? (
        <WorkspaceAlert resource="sales flow" action="create" />
      ) : (
        <NewSalesFlowForm popupId={selectedPopupId} />
      )}
    </FormPageLayout>
  )
}
