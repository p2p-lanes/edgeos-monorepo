import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import {
  CalendarRange,
  Check,
  CheckCircle2,
  Eye,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { type EventVenuePublic, EventVenuesService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/events/venues/")({
  component: VenuesPage,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Venues - EdgeOS" }],
  }),
})

const columns: ColumnDef<EventVenuePublic>[] = [
  {
    accessorKey: "title",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    cell: ({ row }) => (
      <span className="font-medium">
        {row.original.title || "Untitled venue"}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.status === "pending" ? "pending" : "active"}
      />
    ),
  },
  {
    accessorKey: "location",
    header: "Location",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.location || "—"}
      </span>
    ),
  },
  {
    accessorKey: "capacity",
    header: "Capacity",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.capacity ?? "—"}
      </span>
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <VenueRowActions venue={row.original} />
      </div>
    ),
  },
]

function VenueRowActions({ venue }: { venue: EventVenuePublic }) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { isAdmin } = useAuth()

  const deleteMutation = useMutation({
    mutationFn: () => EventVenuesService.deleteVenue({ venueId: venue.id }),
    onSuccess: () => {
      showSuccessToast("Venue deleted successfully")
      setDeleteDialogOpen(false)
    },
    onError: createErrorHandler(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["event-venues"] }),
  })

  const approveMutation = useMutation({
    mutationFn: () =>
      EventVenuesService.updateVenue({
        venueId: venue.id,
        requestBody: { status: "active" },
      }),
    onSuccess: () => showSuccessToast("Venue approved"),
    onError: createErrorHandler(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["event-venues"] }),
  })

  const isPending = venue.status === "pending"
  const editLabel = isAdmin ? "Edit venue" : "View venue"

  return (
    <>
      <div className="flex items-center justify-end gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Schedule venue"
          title="Schedule"
          onClick={() =>
            navigate({
              to: "/events/venues/$venueId/schedule",
              params: { venueId: venue.id },
            })
          }
        >
          <CalendarRange className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={editLabel}
          title={isAdmin ? "Edit" : "View"}
          onClick={() =>
            navigate({
              to: "/events/venues/$venueId/edit",
              params: { venueId: venue.id },
            })
          }
        >
          {isAdmin ? (
            <Pencil className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </Button>
        {isAdmin && isPending && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Approve venue"
            title="Approve"
            disabled={approveMutation.isPending}
            onClick={() => approveMutation.mutate()}
          >
            <Check className="h-4 w-4" />
          </Button>
        )}
        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete venue"
            title="Delete"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Venue</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{venue.title || "Untitled venue"}
              "? Events referencing this venue will lose the reference. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={deleteMutation.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <LoadingButton
              variant="destructive"
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Delete
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function VenuesTableContent() {
  const searchParams = Route.useSearch()
  const { selectedPopupId } = useWorkspace()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/events/venues/",
  )
  const [pendingOnly, setPendingOnly] = useState(false)

  const { data: venues } = useQuery({
    queryKey: [
      "event-venues",
      {
        popupId: selectedPopupId,
        page: pagination.pageIndex,
        pageSize: pagination.pageSize,
        search,
      },
    ],
    queryFn: () =>
      EventVenuesService.listVenues({
        popupId: selectedPopupId!,
        search: search || undefined,
        skip: pagination.pageIndex * pagination.pageSize,
        limit: pagination.pageSize,
      }),
    enabled: !!selectedPopupId,
    placeholderData: keepPreviousData,
  })

  // Client-side status filter + pending counter. The list endpoint doesn't
  // accept a ``status`` query yet — if pending venues grow into the
  // hundreds we should push this to the backend.
  const rows = venues?.results ?? []
  const pendingCount = useMemo(
    () => rows.filter((v) => v.status === "pending").length,
    [rows],
  )
  const filtered = useMemo(
    () => (pendingOnly ? rows.filter((v) => v.status === "pending") : rows),
    [rows, pendingOnly],
  )

  if (!venues) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={pendingOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setPendingOnly((v) => !v)}
          aria-pressed={pendingOnly}
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Pending approval
          {!pendingOnly && pendingCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {pendingCount}
            </Badge>
          )}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="Search venues..."
        searchValue={search}
        onSearchChange={setSearch}
        serverPagination={
          // When filtering client-side, server pagination stops making
          // sense — fall back to unpaged rendering until pendingOnly is off.
          pendingOnly
            ? undefined
            : {
                total: venues.paging.total,
                pagination: pagination,
                onPaginationChange: setPagination,
              }
        }
        emptyState={
          !search ? (
            <EmptyState
              icon={MapPin}
              title={pendingOnly ? "No pending venues" : "No venues yet"}
              description={
                pendingOnly
                  ? "Venues awaiting approval will appear here."
                  : "Venues will appear here when created."
              }
            />
          ) : undefined
        }
      />
    </div>
  )
}

function VenuesPage() {
  const { selectedPopupId } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Venues</h1>
          <p className="text-muted-foreground">
            Manage event venues for the selected pop-up
          </p>
        </div>
        {selectedPopupId && (
          <Button asChild>
            <Link to="/events/venues/new">
              <Plus className="mr-2 h-4 w-4" />
              Add Venue
            </Link>
          </Button>
        )}
      </div>
      {selectedPopupId ? (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <VenuesTableContent />
          </Suspense>
        </QueryErrorBoundary>
      ) : (
        <WorkspaceAlert resource="venues" />
      )}
    </div>
  )
}
