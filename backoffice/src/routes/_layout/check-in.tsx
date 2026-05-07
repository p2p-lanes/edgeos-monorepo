import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef, Row } from "@tanstack/react-table"
import { ChevronDown, ChevronRight, ClipboardCheck } from "lucide-react"
import { Suspense } from "react"

import { type TicketEventListItem, TicketEventService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"

// ── Search params ─────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_layout/check-in")({
  component: CheckIn,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Check In - EdgeOS" }],
  }),
})

// ── Query helpers ─────────────────────────────────────────────────────────────

function getTicketEventsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
) {
  return {
    queryFn: () =>
      TicketEventService.listTicketEvents({
        popupId: popupId || undefined,
        skip: page * pageSize,
        limit: pageSize,
      }),
    queryKey: ["ticket-events", popupId, { page, pageSize }],
  }
}

// ── Expanded sub-row ──────────────────────────────────────────────────────────

export function TicketEventSubRow({ row }: { row: Row<TicketEventListItem> }) {
  const event = row.original
  const actorLabel =
    event.actor_user_name || event.actor_user_email || event.actor_user_id

  return (
    <div className="border-l-2 border-primary/20 bg-muted/20 py-3 pl-6 pr-4 space-y-1">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {actorLabel && (
          <>
            <dt className="text-muted-foreground font-medium">Actor user</dt>
            <dd className="text-sm">{actorLabel}</dd>
          </>
        )}

        {event.payload && Object.keys(event.payload).length > 0 && (
          <>
            <dt className="text-muted-foreground font-medium">Payload</dt>
            <dd>
              <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </dd>
          </>
        )}
      </dl>
    </div>
  )
}

// ── Columns ───────────────────────────────────────────────────────────────────

const columns: ColumnDef<TicketEventListItem>[] = [
  {
    accessorKey: "occurred_at",
    header: ({ column }) => <SortableHeader label="Date" column={column} />,
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(row.original.occurred_at))}
      </span>
    ),
  },
  {
    id: "attendee",
    header: "Attendee",
    cell: ({ row }) => {
      const { attendee_name, attendee_email } = row.original
      return (
        <div className="flex flex-col">
          <span className="font-medium text-sm">{attendee_name || "—"}</span>
          {attendee_email && (
            <span className="text-xs text-muted-foreground">
              {attendee_email}
            </span>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: "product_name",
    header: "Product",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {row.original.product_name || "—"}
      </span>
    ),
  },
  {
    accessorKey: "source",
    header: "Source",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {row.original.source || "—"}
      </span>
    ),
  },
  {
    id: "expand",
    header: () => <span className="sr-only">Details</span>,
    cell: ({ row }) => {
      const isExpanded = row.getIsExpanded()
      return (
        <button
          type="button"
          className="flex items-center gap-1 text-sm text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation()
            row.toggleExpanded()
          }}
          aria-label={isExpanded ? "Collapse details" : "Expand details"}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      )
    },
  },
]

// ── Table content ─────────────────────────────────────────────────────────────

function CheckInTableContent() {
  const { selectedPopupId } = useWorkspace()
  const searchParams = Route.useSearch()
  const { pagination, setPagination } = useTableSearchParams(
    searchParams,
    "/check-in",
  )

  const { data: events } = useQuery({
    ...getTicketEventsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
    ),
    placeholderData: keepPreviousData,
  })

  if (!events) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={events.results}
      hiddenOnMobile={["source", "product_name"]}
      serverPagination={{
        total: events.paging.total,
        pagination,
        onPaginationChange: setPagination,
      }}
      renderSubComponent={TicketEventSubRow}
      emptyState={
        <EmptyState
          icon={ClipboardCheck}
          title="No check-in events"
          description="Ticket scan events will appear here once attendees start checking in."
        />
      }
    />
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function CheckIn() {
  const { isContextReady } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Check In</h1>
        <p className="text-muted-foreground">
          Scan history — ticket check-in events
        </p>
      </div>
      {!isContextReady ? (
        <WorkspaceAlert resource="check-in events" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <CheckInTableContent />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
