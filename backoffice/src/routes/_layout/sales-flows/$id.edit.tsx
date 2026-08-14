import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { PopupsService, SalesFlowsService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { SalesFlowForm } from "@/components/forms/SalesFlowForm"
import { SalesFlowScopeBanner } from "@/components/forms/SalesFlowScopeBanner"
import { SalesFlowUrlCard } from "@/components/forms/SalesFlowUrlCard"
import { FlowSectionLinks } from "@/components/SalesFlows/FlowSectionLinks"
import { FlowStandingCard } from "@/components/SalesFlows/FlowStandingCard"
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

      <FlowStandingCard popupId={salesFlow.popup_id} flowId={flowId} />

      {/*
        What it sells comes before how it behaves, and the order is not
        cosmetic. A door can be configured exactly like every other one and
        still be a completely different door, because what it puts on sale is
        the difference — a volunteers way in with one pass and no merch reads
        as an identical copy until you look here.

        These live in their own sections; this points at them with the flow
        already selected. Reviewers are not among them: they belong to the
        gathering, and a flow opts out through `reviewers_mode` below, which
        is a decision rather than a place to keep a list.
      */}
      <InlineSection title="What it sells">
        <FlowSectionLinks
          popupId={salesFlow.popup_id}
          flowId={flowId}
          flowType={salesFlow.type}
        />
      </InlineSection>

      <Separator />

      <SalesFlowForm
        popupId={salesFlow.popup_id}
        defaultValues={salesFlow}
        onSuccess={goBack}
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
