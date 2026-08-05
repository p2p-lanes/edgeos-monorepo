import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { SalesFlowsService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { SalesFlowForm } from "@/components/forms/SalesFlowForm"
import { Skeleton } from "@/components/ui/skeleton"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/sales-flows/$id/edit")({
  component: EditSalesFlowPage,
  head: () => ({
    meta: [{ title: "Edit Sales Flow - EdgeOS" }],
  }),
})

function getSalesFlowQueryOptions(flowId: string) {
  return {
    queryKey: ["sales-flows", flowId],
    queryFn: () => SalesFlowsService.getSalesFlow({ flowId }),
  }
}

function EditSalesFlowContent({ flowId }: { flowId: string }) {
  const goBack = useGoBack({ to: "/sales-flows" })
  const { data: salesFlow } = useSuspenseQuery(getSalesFlowQueryOptions(flowId))

  return (
    <SalesFlowForm
      popupId={salesFlow.popup_id}
      defaultValues={salesFlow}
      onSuccess={goBack}
    />
  )
}

function EditSalesFlowPage() {
  const { id } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Sales Flow"
      description="Update how attendees apply for or purchase this gathering"
      backTo="/sales-flows"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditSalesFlowContent flowId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
