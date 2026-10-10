import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { ColumnDef, Row } from "@tanstack/react-table"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  ClipboardCheck,
} from "lucide-react"
import { Suspense, useCallback, useMemo } from "react"
import QRCode from "react-qr-code"

import {
  type CheckInListItem,
  CheckInService,
  PopupsService,
  ProductsService,
  SalesFlowsService,
} from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import {
  FilterBuilder,
  type FilterCondition,
  type FilterFieldDef,
  type FilterMatch,
  isCompleteCondition,
  sanitizeFilterConditions,
} from "@/components/Common/FilterBuilder"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"
import { useCurrentTenant } from "@/hooks/useCurrentTenant"
import {
  type TableSearchParams,
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { getPortalBaseUrl, getSelfCheckInUrl } from "@/lib/portal-urls"

// ── Search params ─────────────────────────────────────────────────────────────

type CheckInSearchParams = TableSearchParams & {
  match?: FilterMatch
  filters?: FilterCondition[]
}

export const Route = createFileRoute("/_layout/check-in")({
  component: CheckIn,
  validateSearch: (raw: Record<string, unknown>): CheckInSearchParams => {
    const filters = sanitizeFilterConditions(raw.filters)
    return {
      ...validateTableSearch(raw),
      ...(raw.match === "any" && filters.length
        ? { match: "any" as const }
        : {}),
      ...(filters.length ? { filters } : {}),
    }
  },
  head: () => ({
    meta: [{ title: "Check In - EdgeOS" }],
  }),
})

// ── Filters ───────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  ticket: "Pass",
  housing: "Housing",
  merch: "Merch",
  patreon: "Patron",
}

const SOURCE_LABELS: Record<string, string> = {
  qr: "QR scan",
  manual: "Manual",
  self_service: "Self-service",
}

const CHECK_IN_FIELD_DEFS: FilterFieldDef[] = [
  {
    key: "source",
    label: "Source",
    kind: "select",
    ops: ["eq", "neq"],
    options: Object.entries(SOURCE_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  },
  {
    key: "has_attendee",
    label: "Has participant",
    kind: "boolean",
    ops: ["eq"],
  },
  { key: "occurred_at", label: "Date", kind: "date", ops: ["before", "after"] },
  {
    key: "sales_flow_id",
    label: "Sales flow",
    kind: "select",
    ops: ["eq", "neq", "is_empty", "not_empty"],
    group: "Products and sales",
  },
  {
    key: "product_id",
    label: "Product",
    kind: "select",
    ops: ["eq", "neq"],
    group: "Products and sales",
  },
  {
    key: "product_category",
    label: "Product type",
    kind: "select",
    ops: ["eq", "neq"],
    options: [
      ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
      { value: "other", label: "Other" },
    ],
    group: "Products and sales",
  },
]

// ── Query helpers ─────────────────────────────────────────────────────────────

function getCheckInsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  search: string,
  filtersJson: string | undefined,
) {
  return {
    queryFn: () =>
      CheckInService.listCheckIns({
        popupId: popupId || undefined,
        search: search || undefined,
        filters: filtersJson,
        skip: page * pageSize,
        limit: pageSize,
      }),
    queryKey: [
      "check-ins",
      popupId,
      { page, pageSize, search, filters: filtersJson },
    ],
  }
}

// ── Expanded sub-row ──────────────────────────────────────────────────────────

export function CheckInSubRow({ row }: { row: Row<CheckInListItem> }) {
  const event = row.original
  const scannedByName = event.actor_user_name?.trim() || null
  const scannedByEmail = event.actor_user_email || null
  // Format: "name - email" when both, just email when only email,
  // hide the row entirely when neither (the bare UUID fallback was noise).
  let scannedBy: string | null = null
  if (scannedByName && scannedByEmail) {
    scannedBy = `${scannedByName} - ${scannedByEmail}`
  } else if (scannedByName) {
    scannedBy = scannedByName
  } else if (scannedByEmail) {
    scannedBy = scannedByEmail
  }

  // The holder column already shows the buyer when there is no participant;
  // here the buyer only adds information when someone else holds the unit.
  const boughtBy =
    event.attendee_name || event.attendee_email
      ? (event.buyer_email ?? null)
      : null
  const showBoughtBy =
    boughtBy !== null &&
    boughtBy.toLowerCase() !== event.attendee_email?.toLowerCase()

  return (
    <div className="border-l-2 border-primary/20 bg-muted/20 py-3 pl-6 pr-4 space-y-1">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {event.check_in_code && (
          <>
            <dt className="text-muted-foreground font-medium">Code</dt>
            <dd className="font-mono text-sm">{event.check_in_code}</dd>
          </>
        )}
        {showBoughtBy && (
          <>
            <dt className="text-muted-foreground font-medium">Bought by</dt>
            <dd className="text-sm">
              {event.buyer_name && event.buyer_name !== boughtBy
                ? `${event.buyer_name} - ${boughtBy}`
                : boughtBy}
            </dd>
          </>
        )}
        {scannedBy && (
          <>
            <dt className="text-muted-foreground font-medium">Scanned by</dt>
            <dd className="text-sm">{scannedBy}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

// ── Cells ─────────────────────────────────────────────────────────────────────

/** Who the scanned unit belongs to: its participant, else whoever bought it. */
export function HolderCell({ event }: { event: CheckInListItem }) {
  const hasAttendee = Boolean(event.attendee_name || event.attendee_email)
  const name = hasAttendee ? event.attendee_name : event.buyer_name
  const email = hasAttendee ? event.attendee_email : event.buyer_email
  const isBuyer = !hasAttendee && Boolean(name || email)

  return (
    <div className="flex flex-col">
      <span className="flex items-center gap-1.5 font-medium text-sm">
        {name || email || "—"}
        {isBuyer && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            Buyer
          </Badge>
        )}
      </span>
      {email && name && (
        <span className="text-xs text-muted-foreground">{email}</span>
      )}
    </div>
  )
}

export function ProductCell({ event }: { event: CheckInListItem }) {
  const category = event.product_category
  const categoryLabel = category
    ? (CATEGORY_LABELS[category] ?? category)
    : null
  const unitLabel =
    event.unit_index != null && event.unit_count != null && event.unit_count > 1
      ? `Unit ${event.unit_index + 1} of ${event.unit_count}`
      : null

  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-sm">
        {event.product_name || "—"}
        {categoryLabel && (
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {categoryLabel}
          </Badge>
        )}
      </span>
      {unitLabel && (
        <span className="text-xs text-muted-foreground">{unitLabel}</span>
      )}
    </div>
  )
}

// ── Columns ───────────────────────────────────────────────────────────────────

const columns: ColumnDef<CheckInListItem>[] = [
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
    header: "Holder",
    cell: ({ row }) => <HolderCell event={row.original} />,
  },
  {
    accessorKey: "product_name",
    header: "Product",
    cell: ({ row }) => <ProductCell event={row.original} />,
  },
  {
    accessorKey: "sales_flow_name",
    header: "Sales flow",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {row.original.sales_flow_name || "—"}
      </span>
    ),
  },
  {
    accessorKey: "source",
    header: "Source",
    cell: ({ row }) => {
      const { source } = row.original
      return (
        <span className="text-muted-foreground text-sm">
          {source ? (SOURCE_LABELS[source] ?? source) : "—"}
        </span>
      )
    },
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
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/check-in",
  )

  const filterMatch = searchParams.match ?? "all"
  const filterConditions = useMemo(
    () => searchParams.filters ?? [],
    [searchParams.filters],
  )
  const filtersJson = useMemo(() => {
    const complete = filterConditions.filter(isCompleteCondition)
    return complete.length
      ? JSON.stringify({ match: filterMatch, conditions: complete })
      : undefined
  }, [filterConditions, filterMatch])

  const setFilters = useCallback(
    (match: FilterMatch, conditions: FilterCondition[]) => {
      navigate({
        to: "/check-in",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          match:
            match === "any" && conditions.length ? ("any" as const) : undefined,
          filters: conditions.length ? conditions : undefined,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const clearView = useCallback(() => {
    navigate({
      to: "/check-in",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        match: undefined,
        filters: undefined,
        search: undefined,
        page: 0,
      }),
      replace: true,
    })
  }, [navigate])

  const { data: salesFlows } = useQuery({
    queryKey: ["sales-flows", selectedPopupId],
    queryFn: () =>
      SalesFlowsService.listSalesFlows({ popupId: selectedPopupId as string }),
    enabled: !!selectedPopupId,
  })

  const { data: products } = useQuery({
    queryKey: ["products", selectedPopupId, "check-in-filter"],
    queryFn: () =>
      ProductsService.listProducts({
        popupId: selectedPopupId as string,
        limit: 1000,
      }),
    enabled: !!selectedPopupId,
  })

  const filterFields = useMemo<FilterFieldDef[]>(
    () =>
      CHECK_IN_FIELD_DEFS.map((field) => {
        if (field.key === "sales_flow_id") {
          return {
            ...field,
            options: (salesFlows?.results ?? []).map((flow) => ({
              value: flow.id,
              label: flow.name,
            })),
          }
        }
        if (field.key === "product_id") {
          return {
            ...field,
            options: (products?.results ?? []).map((product) => ({
              value: product.id,
              label: product.name,
            })),
          }
        }
        return field
      }),
    [products?.results, salesFlows?.results],
  )

  const { data: events } = useQuery({
    ...getCheckInsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
      filtersJson,
    ),
    placeholderData: keepPreviousData,
  })

  if (!events) return <Skeleton className="h-64 w-full" />

  const hasActiveView = Boolean(filterConditions.length || search)

  return (
    <DataTable
      columns={columns}
      data={events.results}
      hiddenOnMobile={["source", "product_name", "sales_flow_name"]}
      searchPlaceholder="Search by name, email, code or product..."
      searchValue={search}
      onSearchChange={setSearch}
      filterBar={
        <div className="flex flex-wrap items-center gap-2">
          <FilterBuilder
            fields={filterFields}
            match={filterMatch}
            conditions={filterConditions}
            onChange={setFilters}
            emptyMessage="No filters applied. Add a filter to narrow down check-ins."
          />
          {hasActiveView && (
            <Button
              variant="ghost"
              className="h-9 text-muted-foreground"
              onClick={clearView}
            >
              Clear
            </Button>
          )}
        </div>
      }
      serverPagination={{
        total: events.paging.total,
        pagination,
        onPaginationChange: setPagination,
      }}
      renderSubComponent={CheckInSubRow}
      emptyState={
        hasActiveView ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No matching check-ins"
            description="No scans match the current search and filters."
          />
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="No check-in events"
            description="Pass and merch scan events will appear here once people start checking in."
          />
        )
      }
    />
  )
}

function SelfServiceCheckInCard() {
  const { selectedPopupId } = useWorkspace()
  const queryClient = useQueryClient()
  const { data: tenant, isLoading: isTenantLoading } = useCurrentTenant()
  const [copiedText, copy] = useCopyToClipboard()
  const { data: popup, isLoading } = useQuery({
    queryKey: ["popups", selectedPopupId],
    queryFn: () => PopupsService.getPopup({ popupId: selectedPopupId! }),
    enabled: !!selectedPopupId,
  })
  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      PopupsService.updatePopup({
        popupId: selectedPopupId!,
        requestBody: { self_check_in_enabled: enabled },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["popups"] })
    },
  })

  if (isLoading || isTenantLoading) return <Skeleton className="h-56 w-full" />

  const baseUrl = getPortalBaseUrl(tenant)
  const selfCheckInUrl =
    baseUrl && popup?.slug ? getSelfCheckInUrl(baseUrl, popup.slug) : null
  const copied = copiedText === selfCheckInUrl

  if (!selfCheckInUrl) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Self-service check-in</CardTitle>
        <CardDescription>
          Share this URL or QR code with attendees so they can check themselves
          in from the portal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!popup?.self_check_in_enabled ? (
          <div className="flex flex-col gap-3 rounded-md border border-warning/25 bg-warning-soft px-3 py-2 text-sm text-warning sm:flex-row sm:items-center sm:justify-between">
            <span>Self-service check-in is disabled for this gathering</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-warning/25 bg-background text-warning hover:bg-warning-soft"
              disabled={toggleMutation.isPending}
              onClick={() => toggleMutation.mutate(true)}
            >
              {toggleMutation.isPending ? "Enabling..." : "Enable"}
            </Button>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-[1fr_auto]">
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 p-3 font-mono text-sm break-all">
                {selfCheckInUrl}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copy(selfCheckInUrl)}
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Clipboard className="h-4 w-4" />
                  )}
                  {copied ? "Copied" : "Copy URL"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate(false)}
                >
                  {toggleMutation.isPending ? "Disabling..." : "Disable"}
                </Button>
              </div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <QRCode value={selfCheckInUrl} size={160} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
          Scan history for passes and merch pickups
        </p>
      </div>
      {!isContextReady ? (
        <WorkspaceAlert resource="check-in events" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <SelfServiceCheckInCard />
            <CheckInTableContent />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
