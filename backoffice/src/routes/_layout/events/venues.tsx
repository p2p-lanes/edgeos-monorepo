import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { MapPin, Pencil, Plus } from "lucide-react"
import { Suspense } from "react"

import { EventVenuesService, type EventVenuePublic } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"

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
    cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
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
    cell: ({ row }) => <VenueEditButton venueId={row.original.id} />,
  },
]

function VenueEditButton({ venueId }: { venueId: string }) {
  const navigate = useNavigate()
  return (
    <div className="flex justify-end">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Edit venue"
        onClick={() =>
          navigate({ to: "/events/venues-edit", search: { venueId } })
        }
      >
        <Pencil className="h-4 w-4" />
      </Button>
    </div>
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
        <p className="text-muted-foreground">Select a pop-up from the sidebar to view venues.</p>
      )}
    </div>
  )
}
