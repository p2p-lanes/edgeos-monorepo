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
import { salesFlowsQueryKey } from "@/lib/salesFlowQueries"
import { groupByReach } from "@/lib/salesFlowReach"

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
 * Every way into this gathering, grouped by who can reach it.
 *
 * This started as a table of name, slug, type and visibility, which could not
 * answer the only question worth asking here — which door is broken — because
 * a flow with an empty checkout rendered exactly like a working one. Cards
 * with readiness fixed that (slice 8).
 *
 * The grouping answers the second question, which no single row can: whether
 * a stranger can find this door, or has to be sent it, or has to already be
 * coming. That is not a column, it is a flow's kind and its listing taken
 * together, so the screen is the answer rather than the ingredients.
 *
 * Readiness is fetched separately so a door still lists when the check itself
 * fails.
 */
function FlowMap({ popupId }: { popupId: string }) {
  const { data: salesFlows } = useQuery({
    queryKey: salesFlowsQueryKey(popupId),
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
        description="Create one to decide how people apply for or buy into this gathering."
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

  const groups = groupByReach(salesFlows.results)

  return (
    <div className="flex flex-col gap-8">
      {blockedCount > 0 && (
        <p className="text-sm text-destructive">
          {blockedCount} of {salesFlows.results.length} sales flows cannot take
          a purchase right now.
        </p>
      )}
      {groups.map((group) => (
        <section key={group.id} className="flex flex-col gap-3">
          <header className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold">
              {group.title}
              <span className="ml-2 font-normal text-muted-foreground">
                {group.flows.length}
              </span>
            </h2>
            <p className="text-sm text-muted-foreground">{group.description}</p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {group.flows.map((flow) => (
              <FlowMapCard
                key={flow.id}
                flow={flow}
                readiness={readinessById.get(flow.id)}
              />
            ))}
          </div>
        </section>
      ))}
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
            Every sales flow of this gathering, grouped by who can reach it
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
