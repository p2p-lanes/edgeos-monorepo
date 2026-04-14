import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import {
  EllipsisVertical,
  ListTree,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { Suspense, useState } from "react"

import { type TrackPublic, TracksService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
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

export const Route = createFileRoute("/_layout/events/tracks/")({
  component: TracksPage,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Tracks - EdgeOS" }],
  }),
})

function TrackActionsMenu({ track }: { track: TrackPublic }) {
  const [open, setOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteMutation = useMutation({
    mutationFn: () => TracksService.deleteTrack({ trackId: track.id }),
    onSuccess: () => {
      showSuccessToast("Track deleted successfully")
      setDeleteOpen(false)
      setOpen(false)
    },
    onError: createErrorHandler(showErrorToast),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["tracks"] }),
  })

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Track actions">
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link
              to="/events/tracks/$trackId/edit"
              params={{ trackId: track.id }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Link>
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
            <DialogTitle>Delete Track</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{track.name}"? This action cannot
              be undone.
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

const columns: ColumnDef<TrackPublic>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "topic",
    header: "Topics",
    cell: ({ row }) => {
      const topics = row.original.topic ?? []
      if (topics.length === 0) {
        return <span className="text-muted-foreground">—</span>
      }
      return (
        <div className="flex flex-wrap gap-1">
          {topics.map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
        </div>
      )
    },
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => (
      <span className="text-muted-foreground truncate max-w-[280px] block">
        {row.original.description || "—"}
      </span>
    ),
  },
  {
    id: "events",
    header: () => <span className="sr-only">Events</span>,
    cell: ({ row }) => (
      <Button variant="link" size="sm" asChild className="px-0">
        <Link
          to="/events/tracks/$trackId/edit"
          params={{ trackId: row.original.id }}
        >
          View events
        </Link>
      </Button>
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <TrackActionsMenu track={row.original} />
      </div>
    ),
  },
]

function TracksTableContent() {
  const searchParams = Route.useSearch()
  const { selectedPopupId } = useWorkspace()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/events/tracks",
  )

  const { data: tracks } = useQuery({
    queryKey: [
      "tracks",
      {
        popupId: selectedPopupId,
        page: pagination.pageIndex,
        pageSize: pagination.pageSize,
        search,
      },
    ],
    queryFn: () =>
      TracksService.listTracks({
        popupId: selectedPopupId!,
        search: search || undefined,
        skip: pagination.pageIndex * pagination.pageSize,
        limit: pagination.pageSize,
      }),
    enabled: !!selectedPopupId,
    placeholderData: keepPreviousData,
  })

  if (!tracks) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={tracks.results}
      searchPlaceholder="Search tracks..."
      hiddenOnMobile={["description", "topic"]}
      searchValue={search}
      onSearchChange={setSearch}
      serverPagination={{
        total: tracks.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={ListTree}
            title="No tracks yet"
            description="Create the first track for this pop-up."
            action={
              <Button asChild>
                <Link to="/events/tracks/new">
                  <Plus className="mr-2 h-4 w-4" />
                  New Track
                </Link>
              </Button>
            }
          />
        ) : undefined
      }
    />
  )
}

function TracksPage() {
  const { selectedPopupId } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tracks</h1>
          <p className="text-muted-foreground">
            Group events into topic-based tracks for the selected pop-up
          </p>
        </div>
        {selectedPopupId && (
          <Button asChild>
            <Link to="/events/tracks/new">
              <Plus className="mr-2 h-4 w-4" />
              New Track
            </Link>
          </Button>
        )}
      </div>
      {selectedPopupId ? (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <TracksTableContent />
          </Suspense>
        </QueryErrorBoundary>
      ) : (
        <WorkspaceAlert resource="tracks" />
      )}
    </div>
  )
}
