import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { PopupsService, SalesFlowsService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { CopyFormToFlowDialog } from "@/components/forms/CopyFormToFlowDialog"
import { FlowEmailTemplatesSection } from "@/components/forms/FlowEmailTemplatesSection"
import { ReviewersManager } from "@/components/forms/ReviewersManager"
import { SalesFlowForm } from "@/components/forms/SalesFlowForm"
import { SalesFlowScopeBanner } from "@/components/forms/SalesFlowScopeBanner"
import { SalesFlowUrlCard } from "@/components/forms/SalesFlowUrlCard"
import { InlineSection } from "@/components/ui/inline-form"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentTenant } from "@/hooks/useCurrentTenant"
import { useGoBack } from "@/hooks/useGoBack"
import { getPortalBaseUrl } from "@/lib/portal-urls"

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
  const { data: popup } = useQuery({
    queryKey: ["popups", salesFlow.popup_id],
    queryFn: () => PopupsService.getPopup({ popupId: salesFlow.popup_id }),
  })
  const { data: tenant } = useCurrentTenant()
  const portalBaseUrl = getPortalBaseUrl(tenant)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <SalesFlowScopeBanner flowName={salesFlow.name} />

      <SalesFlowUrlCard
        portalBaseUrl={portalBaseUrl}
        popupSlug={popup?.slug}
        flow={salesFlow}
      />

      <SalesFlowForm
        popupId={salesFlow.popup_id}
        defaultValues={salesFlow}
        onSuccess={goBack}
      />

      <Separator />

      <InlineSection title="Form">
        <p className="px-1 text-xs text-muted-foreground">
          Reuse another flow's (or the event's shared) application form as a
          starting point for this one.
        </p>
        <CopyFormToFlowDialog
          popupId={salesFlow.popup_id}
          targetFlowId={flowId}
        />
      </InlineSection>

      <Separator />

      <FlowEmailTemplatesSection popupId={salesFlow.popup_id} flowId={flowId} />

      <Separator />

      <ReviewersManager
        popupId={salesFlow.popup_id}
        tenantId={salesFlow.tenant_id}
        flowId={flowId}
        reviewersMode={salesFlow.reviewers_mode}
        variant="inline"
      />
    </div>
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
