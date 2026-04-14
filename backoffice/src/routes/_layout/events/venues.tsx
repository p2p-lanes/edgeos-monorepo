import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { EllipsisVertical, MapPin, Pencil, Plus, Trash2 } from "lucide-react"
import { Suspense, useState } from "react"

import { EventVenuesService, type EventVenuePublic } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/events/venues")({
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
    accessorKey: "location",
    header: "Location",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.location || "—"}</span>
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
        <VenueActionsMenu venue={row.original} />
      </div>
    ),
  },
]

function VenueActionsMenu({ venue }: { venue: EventVenuePublic }) {
  const [open, setOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteMutation = useMutation({
    mutationFn: () => EventVenuesService.deleteVenue({ venueId: venue.id }),
    onSuccess: () => {
      showSuccessToast("Venue deleted successfully")
      setDeleteOpen(false)
      setOpen(false)
    },
    onError: createErrorHandler(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["event-venues"] }),
  })

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Venue actions">
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setOpen(false)
              navigate({
                to: "/events/venues-edit",
                search: { venueId: venue.id },
              })
            }}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => e.preventDefault()}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
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
              <Button variant="outline">Cancel</Button>
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
    "/events/venues",
  )

  const { data: venues } = useQuery({
    queryKey: [
      "event-venues",
      { popupId: selectedPopupId, page: pagination.pageIndex, pageSize: pagination.pageSize, search },
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

  if (!venues) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={venues.results}
      searchPlaceholder="Search venues..."
      searchValue={search}
      onSearchChange={setSearch}
      serverPagination={{
        total: venues.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={MapPin}
            title="No venues yet"
            description="Venues will appear here when created."
          />
        ) : undefined
      }
    />
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
            <Link to="/events/venues-new">
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
