import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { History } from "lucide-react"
import { Suspense, useState } from "react"

import { type AuditLogPublic, AuditLogsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { AUDIT_ACTION_OPTIONS, describeAuditAction } from "@/lib/auditMessage"

const ALL_ACTIONS = "all"

export const Route = createFileRoute("/_layout/activity")({
  component: Activity,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Activity - EdgeOS" }],
  }),
})

const columns: ColumnDef<AuditLogPublic>[] = [
  {
    accessorKey: "created_at",
    header: "When",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-muted-foreground">
        {new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(row.original.created_at))}
      </span>
    ),
  },
  {
    accessorKey: "actor_label",
    header: "Actor",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.actor_label}</span>
    ),
  },
  {
    id: "action",
    header: "Action",
    cell: ({ row }) => <span>{describeAuditAction(row.original)}</span>,
  },
  {
    accessorKey: "entity_label",
    header: "Attendee",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.entity_label ?? "—"}
      </span>
    ),
  },
]

function ActivityContent({ action }: { action: string }) {
  const { selectedPopupId } = useWorkspace()
  const searchParams = Route.useSearch()
  const { pagination, setPagination } = useTableSearchParams(
    searchParams,
    "/activity",
  )

  const { data } = useQuery({
    queryKey: [
      "audit-logs",
      {
        popupId: selectedPopupId,
        action,
        page: pagination.pageIndex,
        pageSize: pagination.pageSize,
      },
    ],
    queryFn: () =>
      AuditLogsService.listAuditLogs({
        popupId: selectedPopupId || undefined,
        action: action === ALL_ACTIONS ? undefined : action,
        skip: pagination.pageIndex * pagination.pageSize,
        limit: pagination.pageSize,
      }),
    placeholderData: keepPreviousData,
  })

  if (!data) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={data.results}
      serverPagination={{
        total: data.paging.total,
        pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        <EmptyState
          icon={History}
          title="No activity yet"
          description="Admin actions like ticket grants, changes and removals will appear here."
        />
      }
    />
  )
}

function Activity() {
  const { isContextReady } = useWorkspace()
  const [action, setAction] = useState<string>(ALL_ACTIONS)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
          <p className="text-muted-foreground">
            Audit history of admin actions for the selected pop-up
          </p>
        </div>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ACTIONS}>All actions</SelectItem>
            {AUDIT_ACTION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!isContextReady ? (
        <WorkspaceAlert resource="activity" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <ActivityContent action={action} />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
