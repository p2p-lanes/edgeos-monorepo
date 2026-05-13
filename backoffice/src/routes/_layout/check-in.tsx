import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef, Row } from "@tanstack/react-table"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  ClipboardCheck,
} from "lucide-react"
import { Suspense } from "react"
import QRCode from "react-qr-code"

import { type CheckInListItem, CheckInService, PopupsService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
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
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { getPortalBaseUrl, getSelfCheckInUrl } from "@/lib/portal-urls"

// ── Search params ─────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_layout/check-in")({
  component: CheckIn,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Check In - EdgeOS" }],
  }),
})

// ── Query helpers ─────────────────────────────────────────────────────────────

function getCheckInsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
) {
  return {
    queryFn: () =>
      CheckInService.listCheckIns({
        popupId: popupId || undefined,
        skip: page * pageSize,
        limit: pageSize,
      }),
    queryKey: ["check-ins", popupId, { page, pageSize }],
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

  return (
    <div className="border-l-2 border-primary/20 bg-muted/20 py-3 pl-6 pr-4 space-y-1">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
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
    ...getCheckInsQueryOptions(
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
      renderSubComponent={CheckInSubRow}
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
          <div className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <span>Self-service check-in is disabled for this pop-up</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-amber-300 bg-white text-amber-950 hover:bg-amber-100"
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
          Scan history — ticket check-in events
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
