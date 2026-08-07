import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Plus, Workflow } from "lucide-react"
import { Suspense } from "react"

import { SalesFlowsService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { FlowMapCard } from "@/components/SalesFlows/FlowMapCard"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/sales-flows/")({
  component: SalesFlows,
  head: () => ({
    meta: [{ title: "Sales Flows - EdgeOS" }],
  }),
})

function AddSalesFlowButton() {
  return (
    <Button asChild>
      <Link to="/sales-flows/new">
        <Plus className="mr-2 h-4 w-4" />
        Add Sales Flow
      </Link>
    </Button>
  )
}

/**
 * The flow map (sdd/sales-flows-rediseno slice 8).
 *
 * This replaced a table of name, slug, type and visibility. That table
 * could not answer the only question worth asking on this screen — which
 * flow is broken — because a flow with an empty checkout rendered exactly
 * like a working one. Readiness is fetched separately so a flow still
 * lists when the check itself fails.
 */
function FlowMap({ popupId }: { popupId: string }) {
  const { data: salesFlows } = useQuery({
    queryKey: ["sales-flows", { popupId }],
    queryFn: () =>
      SalesFlowsService.listSalesFlows({ popupId, skip: 0, limit: 100 }),
  })

  const { data: readiness } = useQuery({
    queryKey: ["sales-flows", "readiness", { popupId }],
    queryFn: () => SalesFlowsService.listSalesFlowReadiness({ popupId }),
  })

  if (!salesFlows) return <Skeleton className="h-64 w-full" />

  if (salesFlows.results.length === 0) {
    return (
      <EmptyState
        icon={Workflow}
        title="No sales flows yet"
        description="Create a sales flow to control how attendees apply for or purchase this gathering."
        action={
          <Button asChild>
            <Link to="/sales-flows/new">
              <Plus className="mr-2 h-4 w-4" />
              Add Sales Flow
            </Link>
          </Button>
        }
      />
    )
  }

  const readinessById = new Map(
    (readiness ?? []).map((row) => [row.flow_id, row]),
  )
  const blockedCount = (readiness ?? []).filter(
    (row) => row.blockers.length > 0,
  ).length

  return (
    <div className="flex flex-col gap-4">
      {blockedCount > 0 && (
        <p className="text-sm text-destructive">
          {blockedCount} of {salesFlows.results.length} flows cannot take a
          purchase right now.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {salesFlows.results.map((flow) => (
          <FlowMapCard
            key={flow.id}
            flow={flow}
            readiness={readinessById.get(flow.id)}
          />
        ))}
      </div>
    </div>
  )
}

function SalesFlows() {
  const { isOperatorOrAbove } = useAuth()
  const { selectedPopupId, isContextReady } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sales Flows</h1>
          <p className="text-muted-foreground">
            Manage how attendees apply for or purchase this gathering
          </p>
        </div>
        {isOperatorOrAbove && isContextReady && <AddSalesFlowButton />}
      </div>
      {!isContextReady || !selectedPopupId ? (
        <WorkspaceAlert resource="sales flows" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <FlowMap popupId={selectedPopupId} />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
