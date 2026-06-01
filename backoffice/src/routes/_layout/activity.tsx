import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { History } from "lucide-react"
import { Fragment, Suspense, useState } from "react"

import { type AuditLogPublic, AuditLogsService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
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
import {
  AUDIT_ACTION_OPTIONS,
  actorLabel,
  describeAuditAction,
} from "@/lib/auditMessage"

const ALL = "all"

const SOURCE_OPTIONS = [
  { value: "backoffice", label: "Backoffice" },
  { value: "portal", label: "Portal" },
  { value: "system", label: "System" },
]

export const Route = createFileRoute("/_layout/activity")({
  component: Activity,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Activity - EdgeOS" }],
  }),
})

function labelize(key: string): string {
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

function formatValue(value: unknown): string {
  if (value == null || value === "") return "—"
  if (Array.isArray(value)) return value.map((v) => formatValue(v)).join(", ")
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "string") {
    // ISO datetime → human-readable.
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]/.test(value)) {
      const d = new Date(value)
      if (!Number.isNaN(d.getTime())) {
        return new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(d)
      }
    }
    return value
  }
  return String(value)
}

/** Expandable per-row detail: what changed (old → new) plus the snapshot. */
function AuditLogDetail({ log }: { log: AuditLogPublic }) {
  const details = (log.details ?? {}) as Record<string, unknown>
  const changes = (
    details.changes && typeof details.changes === "object"
      ? details.changes
      : null
  ) as Record<string, { old: unknown; new: unknown }> | null
  const snapshot = (
    details.snapshot && typeof details.snapshot === "object"
      ? details.snapshot
      : null
  ) as Record<string, unknown> | null
  const products = Array.isArray(details.products) ? details.products : null

  // Flatten the snapshot plus any top-level detail keys (e.g. rejection_reason)
  // into a single key/value list, hiding raw UUID id fields and the structured
  // keys rendered separately above.
  const flat: Record<string, unknown> = {
    ...(snapshot ?? {}),
    ...Object.fromEntries(
      Object.entries(details).filter(
        ([k]) => !["changes", "products", "snapshot"].includes(k),
      ),
    ),
  }
  const detailEntries = Object.entries(flat).filter(
    ([k, v]) => !k.endsWith("_id") && v != null && v !== "",
  )

  const hasAny =
    (changes && Object.keys(changes).length > 0) ||
    (products && products.length > 0) ||
    detailEntries.length > 0

  return (
    <div className="space-y-3 bg-muted/30 px-4 py-3 text-sm">
      {changes && Object.keys(changes).length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
            Changes
          </p>
          <ul className="space-y-1">
            {Object.entries(changes)
              .filter(([k]) => !(k === "venue_id" && "venue_name" in changes))
              .map(([field, diff]) => (
                <li key={field}>
                  <span className="font-medium">{labelize(field)}</span>:{" "}
                  <span className="text-muted-foreground line-through">
                    {formatValue(diff.old)}
                  </span>
                  {" → "}
                  <span>{formatValue(diff.new)}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {products && products.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
            Products
          </p>
          <ul className="space-y-1">
            {products.map((p, i) => {
              const item = p as Record<string, unknown>
              return (
                <li key={i}>
                  {formatValue(item.quantity ?? 1)}×{" "}
                  {String(item.product_name ?? "ticket")}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {detailEntries.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
            Details
          </p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            {detailEntries.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-muted-foreground">{labelize(k)}</dt>
                <dd>{formatValue(v)}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}

      {!hasAny && (
        <p className="text-muted-foreground">No additional detail.</p>
      )}
    </div>
  )
}

const columns: ColumnDef<AuditLogPublic>[] = [
  {
    accessorKey: "created_at",
    header: ({ column }) => <SortableHeader label="When" column={column} />,
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
    id: "actor",
    header: ({ column }) => <SortableHeader label="Actor" column={column} />,
    cell: ({ row }) => (
      <span className="font-medium">{actorLabel(row.original)}</span>
    ),
  },
  {
    id: "action",
    header: ({ column }) => <SortableHeader label="Action" column={column} />,
    cell: ({ row }) => <span>{describeAuditAction(row.original)}</span>,
  },
  {
    accessorKey: "entity_label",
    header: "Item",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.entity_label ?? "—"}
      </span>
    ),
  },
]

function ActivityContent() {
  const { selectedPopupId } = useWorkspace()
  const searchParams = Route.useSearch()
  const { search, pagination, sorting, setSearch, setPagination, setSorting } =
    useTableSearchParams(searchParams, "/activity")

  const [action, setAction] = useState<string>(ALL)
  const [source, setSource] = useState<string>(ALL)

  const resetPage = () =>
    setPagination({ pageIndex: 0, pageSize: pagination.pageSize })

  const { data } = useQuery({
    queryKey: [
      "audit-logs",
      {
        popupId: selectedPopupId,
        action,
        source,
        search,
        sortBy: sorting[0]?.id,
        sortOrder: sorting[0]?.desc ? "desc" : "asc",
        page: pagination.pageIndex,
        pageSize: pagination.pageSize,
      },
    ],
    queryFn: () =>
      AuditLogsService.listAuditLogs({
        popupId: selectedPopupId || undefined,
        action: action === ALL ? undefined : action,
        source: source === ALL ? undefined : source,
        search: search || undefined,
        sortBy: sorting[0]?.id,
        sortOrder: sorting.length
          ? sorting[0].desc
            ? "desc"
            : "asc"
          : undefined,
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
      searchPlaceholder="Search by actor or item..."
      searchValue={search}
      onSearchChange={setSearch}
      serverSorting={{ sorting, onSortingChange: setSorting }}
      serverPagination={{
        total: data.paging.total,
        pagination,
        onPaginationChange: setPagination,
      }}
      renderSubComponent={({ row }) => <AuditLogDetail log={row.original} />}
      filterBar={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={action}
            onValueChange={(v) => {
              setAction(v)
              resetPage()
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All actions</SelectItem>
              {AUDIT_ACTION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={source}
            onValueChange={(v) => {
              setSource(v)
              resetPage()
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All sources</SelectItem>
              {SOURCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
        <p className="text-muted-foreground">
          Audit history of admin actions for the selected pop-up
        </p>
      </div>
      {!isContextReady ? (
        <WorkspaceAlert resource="activity" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <ActivityContent />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
