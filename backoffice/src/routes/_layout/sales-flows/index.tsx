import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Plus, Workflow } from "lucide-react"
import { Suspense } from "react"

import { type SalesFlowPublic, SalesFlowsService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"

function getSalesFlowsQueryOptions(popupId: string) {
  return {
    queryFn: () =>
      SalesFlowsService.listSalesFlows({
        popupId,
        skip: 0,
        limit: 100,
      }),
    queryKey: ["sales-flows", { popupId }],
  }
}

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

const columns: ColumnDef<SalesFlowPublic>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{row.original.name}</span>
        {row.original.is_default && <Badge variant="secondary">Default</Badge>}
      </div>
    ),
  },
  {
    accessorKey: "slug",
    header: "Slug",
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.original.slug}</span>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
  },
  {
    accessorKey: "visibility",
    header: "Visibility",
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.visibility === "portal_listed" ? "active" : "none"}
        className="capitalize"
      />
    ),
  },
]

function SalesFlowsTableContent({ popupId }: { popupId: string }) {
  const navigate = useNavigate()
  const { data: salesFlows } = useQuery({
    ...getSalesFlowsQueryOptions(popupId),
    placeholderData: keepPreviousData,
  })

  if (!salesFlows) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={salesFlows.results}
      onRowClick={(flow) =>
        navigate({ to: "/sales-flows/$id/edit", params: { id: flow.id } })
      }
      emptyState={
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
      }
    />
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
            <SalesFlowsTableContent popupId={selectedPopupId} />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
