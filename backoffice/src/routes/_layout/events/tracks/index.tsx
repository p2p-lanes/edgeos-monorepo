import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { ListTree, Plus } from "lucide-react"
import { Suspense } from "react"

import { type TrackPublic, TracksService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"

export const Route = createFileRoute("/_layout/events/tracks/")({
  component: TracksPage,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Tracks - EdgeOS" }],
  }),
})

const columns: ColumnDef<TrackPublic>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
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
]

function TracksTableContent() {
  const navigate = useNavigate()
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
      onRowClick={(track) =>
        navigate({
          to: "/events/tracks/$trackId/edit",
          params: { trackId: track.id },
        })
      }
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
            description="Create the first track for this gathering."
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
            Group events into topic-based tracks for the selected gathering
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
