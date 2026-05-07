import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { ColumnDef, Row } from "@tanstack/react-table"
import { ChevronDown, ChevronRight, ClipboardCheck } from "lucide-react"
import { Suspense } from "react"

import { type TicketEventListItem, TicketEventsService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
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
  type TableSearchParams,
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"

// ── Search params ─────────────────────────────────────────────────────────────

const VALID_EVENT_TYPES = new Set(["check_in", "check_out", "void"])

type CheckInSearchParams = TableSearchParams & {
  event_type?: string
}

export const Route = createFileRoute("/_layout/check-in")({
  component: CheckIn,
  validateSearch: (raw: Record<string, unknown>): CheckInSearchParams => ({
    ...validateTableSearch(raw),
    ...(typeof raw.event_type === "string" &&
    VALID_EVENT_TYPES.has(raw.event_type)
      ? { event_type: raw.event_type }
      : {}),
  }),
  head: () => ({
    meta: [{ title: "Check In - EdgeOS" }],
  }),
})

// ── Query helpers ─────────────────────────────────────────────────────────────

function getTicketEventsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  eventType?: string,
) {
  return {
    queryFn: () =>
      TicketEventsService.listTicketEvents({
        popupId: popupId || undefined,
        skip: page * pageSize,
        limit: pageSize,
        eventType: eventType || undefined,
      }),
    queryKey: ["ticket-events", popupId, { page, pageSize, eventType }],
  }
}

// ── Event type filter ─────────────────────────────────────────────────────────

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "check_in", label: "Check In" },
  { value: "check_out", label: "Check Out" },
  { value: "void", label: "Void" },
]

function EventTypeFilter({
  selected,
  onSelect,
}: {
  selected: string | undefined
  onSelect: (value: string | undefined) => void
}) {
  const selectedOption = selected
    ? EVENT_TYPE_OPTIONS.find((o) => o.value === selected)
    : undefined

  return (
    <Select
      value={selectedOption?.value ?? "all"}
      onValueChange={(value) => onSelect(value === "all" ? undefined : value)}
    >
      <SelectTrigger className="h-9 w-[160px]">
        <SelectValue>{selectedOption?.label ?? "All types"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All types</SelectItem>
        {EVENT_TYPE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── Expanded sub-row ──────────────────────────────────────────────────────────

export function TicketEventSubRow({ row }: { row: Row<TicketEventListItem> }) {
  const event = row.original

  return (
    <div className="border-l-2 border-primary/20 bg-muted/20 py-3 pl-6 pr-4 space-y-1">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground font-medium">Ticket UUID</dt>
        <dd className="font-mono text-xs">{event.attendee_product_id}</dd>

        {event.actor_user_id && (
          <>
            <dt className="text-muted-foreground font-medium">Actor user</dt>
            <dd className="font-mono text-xs">{event.actor_user_id}</dd>
          </>
        )}

        <dt className="text-muted-foreground font-medium">Timestamp</dt>
        <dd className="text-xs">
          {new Intl.DateTimeFormat("en-US", {
            dateStyle: "long",
            timeStyle: "medium",
          }).format(new Date(event.occurred_at))}
        </dd>

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
    accessorKey: "event_type",
    header: "Event Type",
    cell: ({ row }) => (
      <Badge variant="outline" className="capitalize">
        {row.original.event_type.replace(/_/g, " ")}
      </Badge>
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
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const { pagination, setPagination } = useTableSearchParams(
    searchParams,
    "/check-in",
  )
  const eventType = searchParams.event_type

  const { data: events } = useQuery({
    ...getTicketEventsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
      eventType,
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
      filterBar={
        <EventTypeFilter
          selected={eventType}
          onSelect={(value) => {
            navigate({
              to: "/check-in",
              search: (prev) => ({ ...prev, event_type: value, page: 0 }),
              replace: true,
            })
          }}
        />
      }
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
          Scan history — ticket check-in and check-out events
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
