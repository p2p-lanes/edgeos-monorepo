import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { SalesFlowForm } from "@/components/forms/SalesFlowForm"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/sales-flows/new")({
  component: NewSalesFlow,
  head: () => ({
    meta: [{ title: "New Sales Flow - EdgeOS" }],
  }),
})

function NewSalesFlow() {
  const navigate = useNavigate()
  const goBack = useGoBack({ to: "/sales-flows" })
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
      description="Add a new way for attendees to apply for or purchase this gathering"
      backTo="/sales-flows"
    >
      {!isContextReady || !selectedPopupId ? (
        <WorkspaceAlert resource="sales flow" action="create" />
      ) : (
        <SalesFlowForm popupId={selectedPopupId} onSuccess={goBack} />
      )}
    </FormPageLayout>
  )
}
